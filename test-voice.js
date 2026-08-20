// Диагностика голосового подключения: node test-voice.js
// Показывает каждый этап подключения к голосовому каналу и где именно рвётся.
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');

const { DISCORD_TOKEN, VOICE_CHANNEL_ID } = process.env;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

client.once('ready', async () => {
  log(`Вход выполнен: ${client.user.tag}`);

  let channel;
  try {
    channel = await client.channels.fetch(VOICE_CHANNEL_ID);
  } catch (e) {
    log(`ОШИБКА: канал ${VOICE_CHANNEL_ID} не найден: ${e.message}`);
    process.exit(1);
  }

  log(`Канал: "${channel?.name}" тип=${channel?.type} (2 = голосовой)`);
  if (!channel?.isVoiceBased?.()) {
    log('ОШИБКА: VOICE_CHANNEL_ID указывает НЕ на голосовой канал!');
    process.exit(1);
  }

  const me = channel.guild.members.me;
  const perms = channel.permissionsFor(me);
  log(`Права в канале: Connect=${perms?.has('Connect')} Speak=${perms?.has('Speak')} ViewChannel=${perms?.has('ViewChannel')}`);

  log('Подключаюсь к голосовому...');
  const connection = joinVoiceChannel({
    channelId: VOICE_CHANNEL_ID,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
    debug: true,
  });

  connection.on('stateChange', (oldState, newState) => {
    log(`Состояние: ${oldState.status} -> ${newState.status}`);
  });
  connection.on('debug', (msg) => {
    log(`debug: ${String(msg).slice(0, 200)}`);
  });
  connection.on('error', (err) => {
    log(`ОШИБКА соединения: ${err.message}`);
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    log('УСПЕХ: голосовое соединение установлено (Ready)');
  } catch (e) {
    log(`ПРОВАЛ: не дошли до Ready за 30 сек (${e.message})`);
    log(`Финальное состояние: ${connection.state.status}`);
  }

  connection.destroy();
  client.destroy();
  process.exit(0);
});

client.login(DISCORD_TOKEN);
