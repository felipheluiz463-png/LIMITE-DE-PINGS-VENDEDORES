import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
} from "discord.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("DISCORD_BOT_TOKEN environment variable is not set.");
  process.exit(1);
}

const STOCK_ROLE_ID = "1481694727005802606";

const LIMITED_USERS = new Set([
  "1404535359886463137",
  "1411787311884140574",
  "1351698009800310804",
  "1267640943633240096",
  "1452255685357080638",
  "1261370166172979220",
  "1146443214312718396",
  "1395226016624017571",
  "1236426708110934110",
  "1488268986209538389", // Novo ID adicionado
]);

const DEFAULT_LIMITS = {
  everyone: 2,
  here: 2,
  stock: 2,
};

const RESTRICT_ROLE_NAME = "Ping Restricted";
const RESET_DELAY_MS = 24 * 60 * 60 * 1000; // 24 hours
const AUTO_DELETE_MS = 30 * 60 * 1000;       // 30 minutos
const PING_MESSAGE_DELETE_MS = 10 * 60 * 1000; // 10 minutos para apagar mensagens de ping

const EMBED_COLOR = 0xb300ff;
const FOOTER_TEXT = "🔥 𝙎𝙣𝙞𝙥𝙚𝙭ˡᵘᵃ ᶜᵒᵐᵐᵘⁿⁱᵗʸ 👻";
const EMBED_IMAGE_URL = "https://cdn.discordapp.com/attachments/1381714599442649138/1488943674522861678/file_000000008870720e9825f146362ee8a5.png?ex=69d1ea1b&is=69d0989b&hm=281be3c480edd00e7b759ce8fa83d43daf3702f79a11c8fdca99cba80bd3ee7a&";

// ─── Data persistence ─────────────────────────────────────────────────────────

const DATA_DIR = join(__dirname, "..", "data");
const DATA_PATH = join(DATA_DIR, "ping_data.json");

function loadData() {
  if (!existsSync(DATA_PATH)) return {};
  try {
    return JSON.parse(readFileSync(DATA_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveData(data) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

function getUserData(data, userId) {
  if (!data[userId]) {
    data[userId] = {
      everyone: DEFAULT_LIMITS.everyone,
      here: DEFAULT_LIMITS.here,
      stock: DEFAULT_LIMITS.stock,
      restricted: false,
      restrictedAt: null,
      restrictedChannelId: null,
    };
  }
  return data[userId];
}

function isAllExhausted(userData) {
  return userData.everyone === 0 && userData.here === 0 && userData.stock === 0;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Send an embed and schedule it to auto-delete after AUTO_DELETE_MS. */
async function sendAutoDelete(channel, embed) {
  const sent = await channel.send({ embeds: [embed] });
  setTimeout(() => {
    sent.delete().catch(() => {});
  }, AUTO_DELETE_MS);
  return sent;
}

/** Send an embed that persists (no auto-delete). */
async function sendPersistent(channel, embed) {
  return channel.send({ embeds: [embed] });
}

/** Send a ping response message and delete it after PING_MESSAGE_DELETE_MS */
async function sendTemporaryPingMessage(channel, embed) {
  const sent = await channel.send({ embeds: [embed] });
  setTimeout(() => {
    sent.delete().catch(() => {});
  }, PING_MESSAGE_DELETE_MS);
  return sent;
}

// ─── Embeds ───────────────────────────────────────────────────────────────────

/**
 * Add the footer image to any embed
 */
function addFooterImage(embed) {
  return embed.setImage(EMBED_IMAGE_URL);
}

/**
 * Status embed — sent after every valid ping use.
 * Shows current remaining quotas. Auto-deletes after 1 hour.
 */
function makeStatusEmbed(userData) {
  const ev = userData.everyone;
  const hr = userData.here;
  const st = userData.stock;

  const description =
    `Olá! 👋\n\n` +
    `Este é o seu status atual de marcações no servidor.\n\n` +
    `Use suas marcações com responsabilidade para evitar bloqueios automáticos.\n\n` +
    `📊 **Limites de Marcação**\n\n` +
    `Everyone: **${ev}/${DEFAULT_LIMITS.everyone}**\n` +
    `Here: **${hr}/${DEFAULT_LIMITS.here}**\n` +
    `Stock: **${st}/${DEFAULT_LIMITS.stock}**\n\n` +
    `⚠️ Quando todos os limites forem utilizados, suas permissões de marcação serão removidas automaticamente por 24 horas.`;

  return addFooterImage(
    new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("📢 Controle de Marcações")
      .setDescription(description)
      .setFooter({ text: FOOTER_TEXT })
      .setTimestamp()
  );
}

/**
 * Blocked embed — sent when a restricted user tries to ping, or when
 * an individual type quota is already at 0 (pre-full-restriction).
 * Auto-deletes after 1 hour.
 */
function makeBlockedEmbed(type) {
  const labels = {
    everyone: "@everyone",
    here: "@here",
    stock: "@Stock",
  };
  const label = type ? labels[type] : "essa marcação";

  return addFooterImage(
    new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("🚫 Marcação Bloqueada")
      .setDescription(
        `Você não possui cota disponível para **${label}**.\n` +
          `Sua mensagem foi removida.`
      )
      .setFooter({ text: FOOTER_TEXT })
      .setTimestamp()
  );
}

/**
 * All-exhausted embed — sent when ALL quotas reach zero.
 * Persistent (no auto-delete).
 */
function makeAllExhaustedEmbed(userId) {
  return addFooterImage(
    new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("🚫 Todos os Limites Esgotados")
      .setDescription(
        `<@${userId}>, você utilizou **todos** os seus limites de marcação.\n\n` +
          `Sua permissão para mencionar **@everyone**, **@here** e **@Stock** foi temporariamente removida.\n\n` +
          `⏰ Seus limites serão restaurados automaticamente em **24 horas**.`
      )
      .addFields(
        { name: "Everyone", value: `0/${DEFAULT_LIMITS.everyone}`, inline: true },
        { name: "Here", value: `0/${DEFAULT_LIMITS.here}`, inline: true },
        { name: "Stock", value: `0/${DEFAULT_LIMITS.stock}`, inline: true }
      )
      .setFooter({ text: FOOTER_TEXT })
      .setTimestamp()
  );
}

/**
 * Restored embed — sent when 24h reset completes.
 * Persistent (no auto-delete).
 */
function makeRestoredEmbed(userId) {
  return addFooterImage(
    new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("✅ Permissões Restauradas")
      .setDescription(
        `<@${userId}>, seus limites de marcação foram redefinidos e suas permissões foram restauradas.`
      )
      .addFields(
        { name: "Everyone", value: `${DEFAULT_LIMITS.everyone}/${DEFAULT_LIMITS.everyone}`, inline: true },
        { name: "Here", value: `${DEFAULT_LIMITS.here}/${DEFAULT_LIMITS.here}`, inline: true },
        { name: "Stock", value: `${DEFAULT_LIMITS.stock}/${DEFAULT_LIMITS.stock}`, inline: true }
      )
      .setFooter({ text: FOOTER_TEXT })
      .setTimestamp()
  );
}

/**
 * Fully-restricted blocked embed — sent when a user with ALL quotas at zero
 * still tries to ping (after restrictions were applied).
 * Auto-deletes after 1 hour.
 */
function makeFullyRestrictedEmbed(userId) {
  return addFooterImage(
    new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("🚫 Marcações Restritas")
      .setDescription(
        `<@${userId}>, você está temporariamente impedido de mencionar everyone, here ou cargos.\n` +
          `Suas permissões serão restauradas automaticamente após 24 horas.`
      )
      .setFooter({ text: FOOTER_TEXT })
      .setTimestamp()
  );
}

/**
 * Embed para notificar que um ping de vendedor foi realizado com sucesso
 * Esta mensagem será apagada após 10 minutos
 */
function makeSellerPingEmbed(userId, pingType) {
  const pingLabels = {
    everyone: "@everyone",
    here: "@here",
    stock: "@Stock"
  };
  
  const label = pingLabels[pingType] || pingType;
  
  return addFooterImage(
    new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("📢 Ping de Vendedor")
      .setDescription(
        `<@${userId}> realizou um ping **${label}** com sucesso!`
      )
      .setFooter({ text: `${FOOTER_TEXT} • Esta mensagem será apagada em 10 minutos` })
      .setTimestamp()
  );
}

// ─── Role helpers ─────────────────────────────────────────────────────────────

async function getOrCreateRestrictedRole(guild) {
  let role = guild.roles.cache.find((r) => r.name === RESTRICT_ROLE_NAME);
  if (!role) {
    role = await guild.roles.create({
      name: RESTRICT_ROLE_NAME,
      color: 0x808080,
      permissions: [],
      reason: "Auto-criado pelo Bot de Controle de Marcações",
    });
    console.log(`[PingBot] Cargo "${RESTRICT_ROLE_NAME}" criado em ${guild.name}`);
  }
  return role;
}

async function applyChannelRestrictions(guild, restrictedRole) {
  for (const [, channel] of guild.channels.cache) {
    if (!channel.isTextBased()) continue;
    try {
      await channel.permissionOverwrites.edit(
        restrictedRole,
        { MentionEveryone: false },
        { reason: "PingBot: cota de marcações esgotada" }
      );
    } catch {
      // Canal sem permissão de edição — ignora
    }
  }
}

async function removeChannelRestrictions(guild, restrictedRole) {
  for (const [, channel] of guild.channels.cache) {
    if (!channel.isTextBased()) continue;
    try {
      await channel.permissionOverwrites.delete(
        restrictedRole,
        "PingBot: cotas redefinidas após 24h"
      );
    } catch {
      // Ignora canais inacessíveis
    }
  }
}

// ─── Restrict / Reset ─────────────────────────────────────────────────────────

const resetTimers = new Map();

async function restrictUser(guild, userId, channelId, data) {
  const userData = getUserData(data, userId);
  userData.restricted = true;
  userData.restrictedAt = Date.now();
  userData.restrictedChannelId = channelId;
  saveData(data);

  console.log(`[PingBot] Restringindo usuário ${userId} no servidor ${guild.name}`);

  try {
    const member = await guild.members.fetch(userId);
    const restrictedRole = await getOrCreateRestrictedRole(guild);
    await member.roles.add(restrictedRole, "Limite de marcações esgotado");
    await applyChannelRestrictions(guild, restrictedRole);
  } catch (err) {
    console.error("[PingBot] Erro ao aplicar restrição de cargo:", err.message);
  }

  try {
    const channel = guild.channels.cache.get(channelId);
    if (channel) {
      await sendPersistent(channel, makeAllExhaustedEmbed(userId));
    }
  } catch (err) {
    console.error("[PingBot] Erro ao enviar embed de esgotamento:", err.message);
  }

  scheduleReset(guild, userId, data);
}

function scheduleReset(guild, userId, data) {
  const userData = data[userId];
  if (!userData?.restrictedAt) return;

  const elapsed = Date.now() - userData.restrictedAt;
  const remaining = Math.max(0, RESET_DELAY_MS - elapsed);

  if (resetTimers.has(userId)) {
    clearTimeout(resetTimers.get(userId));
  }

  console.log(
    `[PingBot] Redefinição agendada para ${userId} em ${Math.round(remaining / 1000)}s`
  );

  const timer = setTimeout(async () => {
    await resetUser(guild, userId, data);
  }, remaining);

  resetTimers.set(userId, timer);
}

async function resetUser(guild, userId, data) {
  console.log(`[PingBot] Redefinindo limites do usuário ${userId}`);

  const userData = getUserData(data, userId);
  const notifyChannelId = userData.restrictedChannelId;

  userData.everyone = DEFAULT_LIMITS.everyone;
  userData.here = DEFAULT_LIMITS.here;
  userData.stock = DEFAULT_LIMITS.stock;
  userData.restricted = false;
  userData.restrictedAt = null;
  userData.restrictedChannelId = null;
  saveData(data);

  resetTimers.delete(userId);

  try {
    const restrictedRole = guild.roles.cache.find(
      (r) => r.name === RESTRICT_ROLE_NAME
    );
    if (restrictedRole) {
      const member = await guild.members.fetch(userId);
      if (member.roles.cache.has(restrictedRole.id)) {
        await member.roles.remove(restrictedRole, "Limites redefinidos após 24h");
      }
      await removeChannelRestrictions(guild, restrictedRole);
    }
  } catch (err) {
    console.error("[PingBot] Erro ao remover restrição de cargo:", err.message);
  }

  try {
    const channel = notifyChannelId
      ? guild.channels.cache.get(notifyChannelId)
      : guild.channels.cache.find((c) => c.isTextBased());
    if (channel) {
      await sendPersistent(channel, makeRestoredEmbed(userId));
    }
  } catch (err) {
    console.error("[PingBot] Erro ao enviar embed de restauração:", err.message);
  }
}

// ─── Bot ──────────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once("ready", async () => {
  console.log(`[PingBot] Conectado como ${client.user.tag}`);
  console.log(`[PingBot] Monitorando ${LIMITED_USERS.size} usuários.`);

  const data = loadData();

  for (const [userId, userData] of Object.entries(data)) {
    if (!userData.restricted || !userData.restrictedAt) continue;

    const elapsed = Date.now() - userData.restrictedAt;

    for (const guild of client.guilds.cache.values()) {
      if (elapsed >= RESET_DELAY_MS) {
        console.log(`[PingBot] Redefinindo ${userId} imediatamente (prazo expirado).`);
        await resetUser(guild, userId, data);
      } else {
        scheduleReset(guild, userId, data);
      }
    }
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!LIMITED_USERS.has(message.author.id)) return;

  const content = message.content;
  const hasEveryone = content.includes("@everyone");
  const hasHere = content.includes("@here");
  const hasStock = message.mentions.roles.has(STOCK_ROLE_ID);

  if (!hasEveryone && !hasHere && !hasStock) return;

  const data = loadData();
  const userData = getUserData(data, message.author.id);

  // ── Usuário totalmente restrito ───────────────────────────────────────────
  if (userData.restricted) {
    try { await message.delete(); } catch {}
    try {
      await sendAutoDelete(
        message.channel,
        makeFullyRestrictedEmbed(message.author.id)
      );
    } catch {}
    return;
  }

  // ── Tipo de ping já esgotado — mostra status e bloqueia ─────────────────
  const alreadyExhaustedTypes = [];
  if (hasEveryone && userData.everyone === 0) alreadyExhaustedTypes.push("everyone");
  if (hasHere && userData.here === 0) alreadyExhaustedTypes.push("here");
  if (hasStock && userData.stock === 0) alreadyExhaustedTypes.push("stock");

  if (alreadyExhaustedTypes.length > 0) {
    try { await message.delete(); } catch {}
    // Mostra o embed de status com os limites atuais (auto-deleta em 30min)
    try {
      await sendAutoDelete(message.channel, makeStatusEmbed(userData));
    } catch {}
    return;
  }

  // ── Envia mensagem temporária de ping do vendedor (apaga em 10 minutos) ──
  try {
    if (hasEveryone) {
      await sendTemporaryPingMessage(message.channel, makeSellerPingEmbed(message.author.id, "everyone"));
    }
    if (hasHere) {
      await sendTemporaryPingMessage(message.channel, makeSellerPingEmbed(message.author.id, "here"));
    }
    if (hasStock) {
      await sendTemporaryPingMessage(message.channel, makeSellerPingEmbed(message.author.id, "stock"));
    }
  } catch (err) {
    console.error("[PingBot] Erro ao enviar mensagem de ping:", err.message);
  }

  // ── Decrementar cotas válidas ─────────────────────────────────────────────
  if (hasEveryone) userData.everyone--;
  if (hasHere) userData.here--;
  if (hasStock) userData.stock--;

  saveData(data);

  // ── Restrição total quando TODOS os limites chegam a zero ─────────────────
  if (isAllExhausted(userData)) {
    await restrictUser(
      message.guild,
      message.author.id,
      message.channel.id,
      data
    );
  }
});

client.login(BOT_TOKEN);
