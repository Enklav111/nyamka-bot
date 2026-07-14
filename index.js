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

const {
  DISCORD_TOKEN,
  VOICE_CHANNEL_ID,
  LINKS_CHANNEL_ID,
  PLAYED_CHANNEL_ID,
  YOUTUBE_COOKIES_FILE,
} = process.env;

const URL_REGEX = /(https?:\/\/[^\s]+)/i;

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

function stopStream() {
  streamCleanup();
  streamCleanup = () => {};
}

function streamWithYtdlp(url) {
  const args = [
    '-f', 'bestaudio/best',
    '-o', '-',
    '--no-playlist',
    '--no-warnings',
    '--no-call-home',
    url,
  ];

  if (YOUTUBE_COOKIES_FILE) {
    args.unshift(YOUTUBE_COOKIES_FILE);
    args.unshift('--cookies');
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    proc.stderr.on('data', (chunk) => {
      console.error('yt-dlp:', chunk.toString().trim());
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('yt-dlp не найден. Установите: apt install -y yt-dlp'));
        return;
      }
      reject(err);
    });

    proc.on('spawn', () => {
      resolve({
        stream: proc.stdout,
        inputType: StreamType.Arbitrary,
        cleanup: () => {
          if (!proc.killed) proc.kill('SIGTERM');
        },
      });
    });
  });
}

async function getAudioStream(url) {
  if (isYoutubeUrl(url)) {
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
