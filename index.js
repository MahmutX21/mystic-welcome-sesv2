require("dotenv").config();

const express = require("express");
const {
  Client,
  GatewayIntentBits,
  Events,
  ChannelType,
} = require("discord.js");

const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");

// =========================
// ENV
// =========================
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;
const DELETE_AFTER_MS = Number(process.env.DELETE_AFTER_MS || 5000);
const PORT = Number(process.env.PORT || 3000);

// =========================
// Basit web server (Railway)
// =========================
const app = express();

app.get("/", (_req, res) => {
  res.status(200).send("Bot aktif.");
});

app.listen(PORT, () => {
  console.log(`Web server ${PORT} portunda çalışıyor.`);
});

// =========================
// Discord Client
// =========================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

let reconnecting = false;

async function connectToVoice() {
  try {
    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (!guild) {
      console.log("Guild bulunamadı.");
      return;
    }

    const channel = await guild.channels.fetch(VOICE_CHANNEL_ID).catch(() => null);
    if (!channel) {
      console.log("Ses kanalı bulunamadı.");
      return;
    }

    if (channel.type !== ChannelType.GuildVoice) {
      console.log("VOICE_CHANNEL_ID bir ses kanalı değil.");
      return;
    }

    const existing = getVoiceConnection(guild.id);
    if (existing && existing.joinConfig.channelId === channel.id) {
      console.log("Bot zaten hedef ses kanalında.");
      return;
    }

    if (existing) {
      try {
        existing.destroy();
      } catch (err) {
        console.log("Eski bağlantı kapatılamadı:", err.message);
      }
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    console.log(`Ses kanalına bağlanılıyor: ${channel.name}`);

    connection.on(VoiceConnectionStatus.Ready, () => {
      reconnecting = false;
      console.log(`Ses kanalına bağlandı: ${channel.name}`);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (reconnecting) return;
      reconnecting = true;

      console.log("Ses bağlantısı koptu, tekrar bağlanma deneniyor...");

      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);

        reconnecting = false;
      } catch {
        try {
          connection.destroy();
        } catch (err) {
          console.log("Bağlantı kapatma hatası:", err.message);
        }

        setTimeout(async () => {
          reconnecting = false;
          await connectToVoice();
        }, 5000);
      }
    });
  } catch (err) {
    reconnecting = false;
    console.error("connectToVoice hatası:", err);
  }
}

async function sendTempWelcome(member) {
  try {
    const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);

    if (!channel) {
      console.log("Hoş geldin kanalı bulunamadı.");
      return;
    }

    if (!channel.isTextBased()) {
      console.log("WELCOME_CHANNEL_ID yazı kanalı değil.");
      return;
    }

    const msg = await channel.send(`Hoş geldin **${member.user.username}**`);

    setTimeout(async () => {
      try {
        await msg.delete();
      } catch (err) {
        console.log("Mesaj silinemedi:", err.message);
      }
    }, DELETE_AFTER_MS);
  } catch (err) {
    console.error("sendTempWelcome hatası:", err);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`${readyClient.user.tag} aktif!`);
  await connectToVoice();
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  await sendTempWelcome(member);
});

// Bot herhangi bir nedenle sesten düşerse yeniden bağlanmayı dene
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (!client.user) return;

  // Bot bir kanaldan düştüyse
  if (
    oldState.member &&
    oldState.member.id === client.user.id &&
    oldState.channelId &&
    !newState.channelId
  ) {
    console.log("Bot ses kanalından düştü, yeniden bağlanılıyor...");
    setTimeout(async () => {
      await connectToVoice();
    }, 5000);
  }
});

client.login(TOKEN);
