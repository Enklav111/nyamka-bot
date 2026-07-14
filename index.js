require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const playdl = require('play-dl');

const {
  DISCORD_TOKEN,
  VOICE_CHANNEL_ID,
  LINKS_CHANNEL_ID,
  PLAYED_CHANNEL_ID,
} = process.env;

// Простая проверка "это похоже на ссылку"
const URL_REGEX = /(https?:\/\/[^\s]+)/i;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// Очередь треков: { url, authorTag, sourceMessageId }
const queue = [];
const player = createAudioPlayer();
let connection = null;
let isPlaying = false;

// Подключение к голосовому каналу (переиспользуем, если уже подключены)
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

// Берём следующий трек из очереди и играем
async function playNext(guild) {
  if (isPlaying) return;
  const item = queue.shift();
  if (!item) return;
  isPlaying = true;

  const linksChannel = await client.channels.fetch(LINKS_CHANNEL_ID);
  const playedChannel = await client.channels.fetch(PLAYED_CHANNEL_ID);

  try {
    await ensureConnection(guild);

    // Убираем сообщение из "списка ещё не сыгранных"
    try {
      const msg = await linksChannel.messages.fetch(item.sourceMessageId);
      await msg.delete();
    } catch (e) {
      // сообщение уже могли удалить вручную — не критично
    }

    // Публикуем во "второй лист" — играет сейчас
    const nowPlayingMsg = await playedChannel.send(
      `▶️ Сейчас играет: ${item.url}\nДобавил: ${item.authorTag}`
    );

    const streamInfo = await playdl.stream(item.url);
    const resource = createAudioResource(streamInfo.stream, {
      inputType: streamInfo.type,
    });

    player.play(resource);

    player.once(AudioPlayerStatus.Idle, async () => {
      isPlaying = false;
      try {
        await nowPlayingMsg.edit(`✅ Отыграно: ${item.url}\nДобавил: ${item.authorTag}`);
      } catch (e) {}
      playNext(guild);
    });

    player.once('error', async (err) => {
      console.error('Ошибка воспроизведения:', err);
      isPlaying = false;
      try {
        await nowPlayingMsg.edit(`⚠️ Не удалось воспроизвести: ${item.url}`);
      } catch (e) {}
      playNext(guild);
    });
  } catch (err) {
    console.error('Ошибка при обработке ссылки:', err);
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
    // Канал строго для ссылок — всё остальное удаляем
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
