require('dotenv').config();
const { spawn } = require('child_process');
const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require('@discordjs/voice');
const playdl = require('play-dl');
const ffmpegPath = require('ffmpeg-static');

const {
  DISCORD_TOKEN,
  VOICE_CHANNEL_ID,
  LINKS_CHANNEL_ID,
  PLAYED_CHANNEL_ID,
  YOUTUBE_COOKIES_FILE,
  VK_COOKIES_FILE,
} = process.env;

const URL_REGEX = /(https?:\/\/[^\s]+)/i;
const YTDLP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const queue = [];
const player = createAudioPlayer();
let connection = null;
let isPlaying = false;
let streamCleanup = () => {};

function isYoutubeUrl(url) {
  return /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i.test(url);
}

function isVkUrl(url) {
  return /(?:^https?:\/\/)?(?:[\w-]+\.)?vk(?:video)?\.(?:com|ru)\//i.test(url);
}

function isSpotifyUrl(url) {
  return /open\.spotify\.com\/(track|album|playlist)|spotify:/i.test(url);
}

function isVkPlaylistUrl(url) {
  return /\/music\/playlist\//i.test(url)
    || /\/audios-/i.test(url)
    || /[?&]z=audio_playlist/i.test(url);
}

function usesYtdlp(url) {
  return isYoutubeUrl(url) || isVkUrl(url);
}

function getCookiesFile(url) {
  if (isVkUrl(url) && VK_COOKIES_FILE) return VK_COOKIES_FILE;
  if (isYoutubeUrl(url) && YOUTUBE_COOKIES_FILE) return YOUTUBE_COOKIES_FILE;
  return null;
}

function buildYtdlpBaseArgs(url) {
  const args = [];

  const cookies = getCookiesFile(url);
  if (cookies) {
    args.push('--cookies', cookies);
  }

  if (isVkUrl(url)) {
    args.push('--user-agent', YTDLP_USER_AGENT);
    args.push('--referer', 'https://vk.com/');
  }

  if (ffmpegPath) {
    args.push('--ffmpeg-location', ffmpegPath);
  }

  args.push('--no-warnings');

  if (isVkPlaylistUrl(url)) {
    args.push('--playlist-items', '1');
  } else {
    args.push('--no-playlist');
  }

  return args;
}

function stopStream() {
  streamCleanup();
  streamCleanup = () => {};
}

function runProcess(cmd, args, { timeoutMs = 60_000, label = cmd } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const fail = (message) => {
      if (settled) return;
      settled = true;
      if (!proc.killed) proc.kill('SIGTERM');
      reject(new Error(message));
    };

    const timer = setTimeout(() => {
      fail(`${label}: таймаут`);
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      const line = text.trim();
      if (line) console.error(`${label}:`, line);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        fail(`${label} не найден`);
        return;
      }
      fail(err.message);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }
      fail(stderr.trim() || `${label} завершился с кодом ${code}`);
    });
  });
}

async function ytdlpGetDirectUrl(url) {
  const args = [...buildYtdlpBaseArgs(url), '-g', '-f', 'bestaudio/best', url];
  const timeoutMs = isVkUrl(url) ? 90_000 : 45_000;
  const { stdout } = await runProcess('yt-dlp', args, { timeoutMs, label: 'yt-dlp' });
  const directUrl = stdout.split('\n').find((line) => line.startsWith('http'));
  if (!directUrl) {
    throw new Error('yt-dlp: не удалось получить прямую ссылку на аудио');
  }
  return directUrl;
}

function streamWithFfmpeg(directUrl, { referer } = {}) {
  if (!ffmpegPath) {
    return Promise.reject(new Error('ffmpeg не найден (ffmpeg-static)'));
  }

  const args = [
    '-nostdin',
    '-loglevel', 'warning',
    '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
  ];

  if (referer) {
    args.push(
      '-user_agent', YTDLP_USER_AGENT,
      '-headers', `Referer: ${referer}\r\n`,
    );
  }

  args.push(
    '-i', directUrl,
    '-vn',
    '-acodec', 'libmp3lame',
    '-b:a', '128k',
    '-f', 'mp3',
    'pipe:1',
  );

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let settled = false;

    const fail = (message) => {
      if (settled) return;
      settled = true;
      if (!proc.killed) proc.kill('SIGTERM');
      reject(new Error(message));
    };

    const timeout = setTimeout(() => {
      fail('ffmpeg: таймаут — аудиопоток не начался');
    }, 30_000);

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      stderr += text;
      if (text) console.error('ffmpeg:', text);
    });

    proc.on('error', (err) => fail(err.message));

    proc.stdout.once('data', () => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      resolve({
        stream: proc.stdout,
        inputType: StreamType.Arbitrary,
        cleanup: () => {
          if (!proc.killed) proc.kill('SIGTERM');
        },
      });
    });

    proc.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (settled) return;
      if (code === 0) return;
      const detail = stderr.trim()
        || (signal ? `сигнал ${signal}` : `код ${code}`);
      fail(`ffmpeg: ${detail}`);
    });
  });
}

async function streamWithYtdlp(url) {
  console.log('Получаем прямую ссылку через yt-dlp...');
  const directUrl = await ytdlpGetDirectUrl(url);
  console.log('Запускаем ffmpeg-поток...');
  return streamWithFfmpeg(directUrl, isVkUrl(url) ? { referer: 'https://vk.com/' } : {});
}

let playdlReady = null;

function ensurePlaydl() {
  if (!playdlReady) {
    playdlReady = playdl.getFreeClientID()
      .then(() => console.log('play-dl: SoundCloud готов'))
      .catch((err) => {
        console.warn('play-dl: SoundCloud client_id:', err.message);
      });
  }
  return playdlReady;
}

async function findSoundCloudUrl(query) {
  await ensurePlaydl();

  const queries = [
    query,
    query.split(/\s[-–|]\s/)[0].trim(),
  ].filter((q, i, arr) => q && arr.indexOf(q) === i);

  for (const q of queries) {
    try {
      const scResults = await playdl.search(q, {
        limit: 8,
        source: { soundcloud: 'tracks' },
      });
      if (scResults[0]?.url) return scResults[0].url;
    } catch (e) {
      console.error('SoundCloud (tracks):', e.message);
    }

    try {
      const mixed = await playdl.search(q, { limit: 15 });
      const hit = mixed.find((r) => r.url && /soundcloud\.com/i.test(r.url));
      if (hit?.url) return hit.url;
    } catch (e) {
      console.error('SoundCloud (mixed):', e.message);
    }
  }

  return null;
}

async function resolveSpotifyUrl(url) {
  const trackUrl = url.split('?')[0];
  if (!/\/track\//i.test(trackUrl)) {
    throw new Error('Spotify: поддерживается только ссылка на один трек (не альбом/плейлист)');
  }

  const res = await fetch(
    `https://open.spotify.com/oembed?url=${encodeURIComponent(trackUrl)}`,
  );
  if (!res.ok) {
    throw new Error('Spotify: не удалось получить информацию о треке');
  }

  const data = await res.json();
  const query = String(data.title || '')
    .replace(/\s*\|\s*Spotify\s*$/i, '')
    .replace(/\s+on Spotify\s*$/i, '')
    .trim();

  if (!query) {
    throw new Error('Spotify: не удалось прочитать название трека');
  }

  console.log(`Spotify → ищем: ${query}`);

  const scUrl = await findSoundCloudUrl(query);
  if (scUrl) {
    console.log(`Найдено на SoundCloud: ${scUrl}`);
    return scUrl;
  }

  if (!YOUTUBE_COOKIES_FILE) {
    throw new Error(
      'Spotify: на SoundCloud не нашли. YouTube на VPS без cookies не играет — ' +
      'настройте YOUTUBE_COOKIES_FILE (инструкция) или киньте прямую ссылку VK / SoundCloud',
    );
  }

  const ytResults = await playdl.search(query, { limit: 3 });
  if (ytResults[0]?.url) {
    console.log(`Найдено на YouTube: ${ytResults[0].url}`);
    return ytResults[0].url;
  }

  throw new Error(`Spotify: не нашли трек «${query}» на SoundCloud или YouTube`);
}

async function resolvePlaybackUrl(url) {
  if (isSpotifyUrl(url)) {
    return resolveSpotifyUrl(url);
  }
  return url;
}

async function getAudioStream(url) {
  const playbackUrl = await resolvePlaybackUrl(url);

  if (isYoutubeUrl(playbackUrl) && !YOUTUBE_COOKIES_FILE) {
    throw new Error(
      'YouTube на VPS без cookies не играет. Настройте YOUTUBE_COOKIES_FILE или используйте VK / SoundCloud',
    );
  }

  if (usesYtdlp(playbackUrl)) {
    return streamWithYtdlp(playbackUrl);
  }

  await ensurePlaydl();
  const streamInfo = await playdl.stream(playbackUrl);
  return {
    stream: streamInfo.stream,
    inputType: streamInfo.type,
    cleanup: () => {},
  };
}

async function ensureConnection(guild) {
  if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
    return connection;
  }
  connection = joinVoiceChannel({
    channelId: VOICE_CHANNEL_ID,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
  });
  await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  connection.subscribe(player);
  return connection;
}

async function playNext(guild) {
  if (isPlaying) return;
  const item = queue.shift();
  if (!item) return;
  isPlaying = true;

  const linksChannel = await client.channels.fetch(LINKS_CHANNEL_ID);
  const playedChannel = await client.channels.fetch(PLAYED_CHANNEL_ID);

  try {
    await ensureConnection(guild);

    try {
      const msg = await linksChannel.messages.fetch(item.sourceMessageId);
      await msg.delete();
    } catch (e) {}

    const nowPlayingMsg = await playedChannel.send(
      `▶️ Сейчас играет: ${item.url}\nДобавил: ${item.authorTag}`
    );

    const { stream, inputType, cleanup } = await getAudioStream(item.url);
    streamCleanup = cleanup;

    const resource = createAudioResource(stream, { inputType });
    player.play(resource);

    player.once(AudioPlayerStatus.Idle, async () => {
      stopStream();
      isPlaying = false;
      try {
        await nowPlayingMsg.edit(`✅ Отыграно: ${item.url}\nДобавил: ${item.authorTag}`);
      } catch (e) {}
      playNext(guild);
    });

    player.once('error', async (err) => {
      console.error('Ошибка воспроизведения:', err);
      stopStream();
      isPlaying = false;
      try {
        await nowPlayingMsg.edit(`⚠️ Не удалось воспроизвести: ${item.url}`);
      } catch (e) {}
      playNext(guild);
    });
  } catch (err) {
    console.error('Ошибка при обработке ссылки:', err);
    stopStream();
    isPlaying = false;
    try {
      await playedChannel.send(`⚠️ Не удалось воспроизвести: ${item.url}\n${err.message}`);
    } catch (e) {}
    playNext(guild);
  }
}

client.once('ready', async () => {
  console.log(`Бот запущен как ${client.user.tag}`);
  await ensurePlaydl();
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== LINKS_CHANNEL_ID) return;

  const match = message.content.match(URL_REGEX);

  if (!match) {
    try {
      await message.delete();
    } catch (e) {}
    return;
  }

  queue.push({
    url: match[1],
    authorTag: message.author.tag,
    sourceMessageId: message.id,
  });

  playNext(message.guild);
});

client.login(DISCORD_TOKEN);
