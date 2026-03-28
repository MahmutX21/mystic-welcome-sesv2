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
// ENV OKUMA
// =========================
function cleanEnv(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r?\n|\r/g, "").trim();
}

const TOKEN = cleanEnv(process.env.TOKEN);
const GUILD_ID = cleanEnv(process.env.GUILD_ID);
const VOICE_CHANNEL_ID = cleanEnv(process.env.VOICE_CHANNEL_ID);
const WELCOME_CHANNEL_ID = cleanEnv(process.env.WELCOME_CHANNEL_ID);
const DELETE_AFTER_MS = Number(cleanEnv(process.env.DELETE_AFTER_MS) || 5000);
const PORT = Number(cleanEnv(process.env.PORT) || 8080);

// =========================
// ENV KONTROL
// =========================
console.log("TOKEN var mı:", TOKEN ? "evet" : "hayır");
console.log("TOKEN uzunluğu:", TOKEN ? TOKEN.length : 0);
console.log("GUILD_ID:", GUILD_ID || "yok");
console.log("VOICE_CHANNEL_ID:", VOICE_CHANNEL_ID || "yok");
console.log("WELCOME_CHANNEL_ID:", WELCOME_CHANNEL_ID || "yok");

if (!TOKEN) {
  console.error("HATA: TOKEN bulunamadı veya boş.");
  process.exit(1);
}

if (!GUILD_ID) {
  console.error("HATA: GUILD_ID bulunamadı.");
  process.exit(1);
}

if (!VOICE_CHANNEL_ID) {
  console.error("HATA: VOICE_CHANNEL_ID bulunamadı.");
  process.exit(1);
}

if (!WELCOME_CHANNEL_ID) {
  console.error("HATA: WELCOME_CHANNEL_ID bulunamadı.");
  process.exit(1);
}

// =========================
// EXPRESS
// =========================
const app = express();

app.get("/", (_req, res) => {
  res.status(200).send("Bot aktif.");
});

app.listen(PORT, () => {
  console.log(`Web server ${PORT} portunda çalışıyor.`);
});

// =========================
// DISCORD CLIENT
// =========================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

let reconnecting = false;

// =========================
// SES KANALINA BAĞLAN
// =========================
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

    let connection = getVoiceConnection(guild.id);

    if (connection && connection.joinConfig.channelId === channel.id) {
      console.log("Bot zaten hedef ses kanalında.");
      return;
    }

    if (connection) {
      try {
        connection.destroy();
      } catch (err) {
        console.log("Eski bağlantı kapatılamadı:", err.message);
      }
    }

    connection = joinVoiceChannel({
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
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
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

// =========================
// HOŞ GELDİN MESAJI
// =========================
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

    const msg = await channel.send(`Hoş geldin ${member}`);

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

// =========================
// BOT HAZIR
// =========================
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`${readyClient.user.tag} aktif!`);
  await connectToVoice();
});

// =========================
// SUNUCUYA YENİ ÜYE GİRİNCE
// =========================
client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  await sendTempWelcome(member);
});

// =========================
// BOT Sesten düşerse tekrar bağlan
// =========================
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (!client.user) return;

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

// =========================
// LOGIN
// =========================
client.login(TOKEN).catch((err) => {
  console.error("Discord login hatası:", err);
  process.exit(1);
});
