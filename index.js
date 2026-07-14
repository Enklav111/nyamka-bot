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

function buildYtdlpArgs(url) {
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

  // VK и др. часто отдают HLS — в pipe напрямую ломается (Broken pipe).
  // Перекодируем в opus-поток через ffmpeg, без сохранения файла на диск.
  args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'opus', '-o', '-', '--no-warnings');

  if (isVkPlaylistUrl(url)) {
    args.push('--playlist-items', '1');
  } else {
    args.push('--no-playlist');
  }

  args.push(url);
  return args;
}

function stopStream() {
  streamCleanup();
  streamCleanup = () => {};
}

function streamWithYtdlp(url) {
  const args = buildYtdlpArgs(url);
  const startTimeoutMs = isVkUrl(url) ? 45_000 : 25_000;

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

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      console.error('yt-dlp:', text.trim());
      if (/ERROR:/i.test(text) && !/Broken pipe/i.test(text)) {
        fail(text.trim());
      }
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        fail('yt-dlp не найден. См. «Инструкция для VPS.md» — установка актуальной версии');
        return;
      }
      fail(err.message);
    });

    proc.on('spawn', () => {
      const timeout = setTimeout(() => {
        fail('yt-dlp: таймаут — аудиопоток не начался');
      }, startTimeoutMs);

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

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (!settled && code !== 0) {
          fail(stderr.trim() || `yt-dlp завершился с кодом ${code}`);
        }
      });
    });
  });
}

async function getAudioStream(url) {
  if (usesYtdlp(url)) {
    return streamWithYtdlp(url);
  }

  const streamInfo = await playdl.stream(url);
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
      await playedChannel.send(`⚠️ Не удалось воспроизвести: ${item.url}`);
    } catch (e) {}
    playNext(guild);
  }
}

client.once('ready', () => {
  console.log(`Бот запущен как ${client.user.tag}`);
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
