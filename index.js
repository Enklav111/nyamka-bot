require('dotenv').config();
const { spawn, execSync } = require('child_process');
const { existsSync } = require('fs');
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

function getFfmpegPath() {
  for (const p of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    if (existsSync(p)) return p;
  }
  try {
    const p = execSync('which ffmpeg', { encoding: 'utf8' }).trim();
    if (p && existsSync(p) && !p.includes('node_modules')) return p;
  } catch (e) {}
  return null;
}

function isYoutubeUrl(url) {
  return /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i.test(url);
}

function isVkUrl(url) {
  return /(?:^https?:\/\/)?(?:[\w-]+\.)?vk(?:video)?\.(?:com|ru)\//i.test(url);
}

function isSoundCloudUrl(url) {
  return /soundcloud\.com/i.test(url);
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
  return isYoutubeUrl(url) || isVkUrl(url) || isSoundCloudUrl(url);
}

function getCookiesFile(url) {
  if (isVkUrl(url) && VK_COOKIES_FILE) return VK_COOKIES_FILE;
  if (isYoutubeUrl(url) && YOUTUBE_COOKIES_FILE) return YOUTUBE_COOKIES_FILE;
  return null;
}

function buildYtdlpBaseArgs(url) {
  const args = [];

  const cookies = getCookiesFile(url);
  if (cookies) args.push('--cookies', cookies);

  if (isVkUrl(url)) {
    args.push('--user-agent', YTDLP_USER_AGENT);
    args.push('--referer', 'https://vk.com/');
  }

  const ff = getFfmpegPath();
  if (ff) args.push('--ffmpeg-location', ff);

  args.push('--no-warnings', '--no-part', '--no-cache-dir');

  if (url && isVkPlaylistUrl(url)) {
    args.push('--playlist-items', '1');
  } else if (url) {
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

    const timer = setTimeout(() => fail(`${label}: таймаут`), timeoutMs);

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      const line = text.trim();
      if (line) console.error(`${label}:`, line);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      fail(err.code === 'ENOENT' ? `${label} не найден` : err.message);
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

async function ytdlpSearch(prefix, query) {
  const args = [
    ...buildYtdlpBaseArgs(null),
    '--flat-playlist',
    '--print', 'webpage_url',
    `${prefix}:${query}`,
  ];
  const { stdout } = await runProcess('yt-dlp', args, { timeoutMs: 45_000, label: 'yt-dlp' });
  return stdout.split('\n').find((line) => line.startsWith('http')) || null;
}

async function findSoundCloudUrl(query) {
  const queries = [
    query,
    query.split(/\s[-–|]\s/)[0].trim(),
  ].filter((q, i, arr) => q && arr.indexOf(q) === i);

  for (const q of queries) {
    try {
      const url = await ytdlpSearch('scsearch1', q);
      if (url) return url;
    } catch (e) {
      console.error('scsearch:', e.message);
    }
  }
  return null;
}

async function resolveSpotifyUrl(url) {
  const trackUrl = url.split('?')[0];
  if (!/\/track\//i.test(trackUrl)) {
    throw new Error('Spotify: только ссылка на один трек (не альбом/плейлист)');
  }

  const res = await fetch(
    `https://open.spotify.com/oembed?url=${encodeURIComponent(trackUrl)}`,
  );
  if (!res.ok) throw new Error('Spotify: не удалось получить информацию о треке');

  const data = await res.json();
  const query = String(data.title || '')
    .replace(/\s*\|\s*Spotify\s*$/i, '')
    .replace(/\s+on Spotify\s*$/i, '')
    .trim();

  if (!query) throw new Error('Spotify: не удалось прочитать название');

  console.log(`Spotify → ищем: ${query}`);

  const scUrl = await findSoundCloudUrl(query);
  if (scUrl) {
    console.log(`Найдено на SoundCloud: ${scUrl}`);
    return scUrl;
  }

  if (YOUTUBE_COOKIES_FILE) {
    try {
      const ytUrl = await ytdlpSearch('ytsearch1', query);
      if (ytUrl) {
        console.log(`Найдено на YouTube: ${ytUrl}`);
        return ytUrl;
      }
    } catch (e) {
      console.error('ytsearch:', e.message);
    }
  } else {
    try {
      const ytUrl = await ytdlpSearch('ytsearch1', query);
      if (ytUrl) {
        console.log(`Найдено на YouTube (bgutil): ${ytUrl}`);
        return ytUrl;
      }
    } catch (e) {
      console.error('ytsearch:', e.message);
    }
  }

  throw new Error(
    `Spotify: не нашли «${query}» на SoundCloud/YouTube. ` +
    'Киньте прямую ссылку VK / SoundCloud',
  );
}

async function resolvePlaybackUrl(url) {
  if (isSpotifyUrl(url)) return resolveSpotifyUrl(url);
  return url;
}

function streamWithYtdlp(url) {
  const args = [
    ...buildYtdlpBaseArgs(url),
    '-f', 'bestaudio[protocol^=http]/bestaudio/best',
    '--hls-use-mpegts',
    '--concurrent-fragments', '4',
    '-o', '-',
    url,
  ];
  const startTimeoutMs = (isVkUrl(url) || isSoundCloudUrl(url)) ? 120_000 : 60_000;

  console.log('Стрим через yt-dlp...');

  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let settled = false;

    const fail = (message) => {
      if (settled) return;
      settled = true;
      if (!proc.killed) proc.kill('SIGTERM');
      reject(new Error(message));
    };

    const timeout = setTimeout(() => {
      fail('yt-dlp: таймаут — поток не начался (VK может грузиться до 2 мин)');
    }, startTimeoutMs);

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      const line = text.trim();
      if (line) console.error('yt-dlp:', line);
      if (/ERROR:/i.test(text) && !/Broken pipe/i.test(text)) {
        fail(text.trim());
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      fail(err.code === 'ENOENT' ? 'yt-dlp не найден' : err.message);
    });

    proc.stdout.once('data', () => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      resolve({
        stream: proc.stdout,
        inputType: StreamType.Arbitrary,
        cleanup: () => { if (!proc.killed) proc.kill('SIGTERM'); },
      });
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      if (code !== 0) {
        fail(stderr.trim() || `yt-dlp завершился с кодом ${code}`);
      }
    });
  });
}

async function getAudioStream(url) {
  const playbackUrl = await resolvePlaybackUrl(url);

  if (!getFfmpegPath()) {
    throw new Error('ffmpeg не найден. На сервере: apt install -y ffmpeg');
  }

  if (usesYtdlp(playbackUrl)) {
    return streamWithYtdlp(playbackUrl);
  }

  throw new Error('Неподдерживаемая ссылка. Используйте YouTube, VK, SoundCloud или Spotify (трек)');
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
      `▶️ Сейчас играет: ${item.url}\nДобавил: ${item.authorTag}`,
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

client.once('ready', () => {
  const ff = getFfmpegPath();
  console.log(`Бот запущен как ${client.user.tag}`);
  if (!ff) {
    console.error('⚠️ ffmpeg НЕ НАЙДЕН! Выполните: apt install -y ffmpeg');
  } else {
    console.log(`ffmpeg: ${ff}`);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== LINKS_CHANNEL_ID) return;

  const match = message.content.match(URL_REGEX);
  if (!match) {
    try { await message.delete(); } catch (e) {}
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
