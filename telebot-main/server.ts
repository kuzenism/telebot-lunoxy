import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

const DATA_DIR = process.env.DATA_DIR || ".";

const ACCOUNTS_FILE = `${DATA_DIR}/accounts.json`;
const SETTINGS_FILE = `${DATA_DIR}/settings.json`;
const ACCOUNT_SETTINGS_FILE = `${DATA_DIR}/account_settings.json`;
const PORT = process.env.PORT || 3000;

interface AccountRecord {
  accountId: string;
  apiId: number;
  apiHash: string;
  sessionString: string;
}

interface PendingAuthState {
  accountId: string;
  apiId: number;
  apiHash: string;
  phone: string;
  phoneCodeHash?: string;
  client: TelegramClient;
}

interface BotSettings {
  isActive: boolean;
  autoDetect: boolean;
  targetGroups: string[];
  responses: { keyword: string; response: string }[];
  antiSpamDelay: number;
}

const defaultSettings: BotSettings = {
  isActive: false,
  autoDetect: false,
  targetGroups: [],
  responses: [],
  antiSpamDelay: 5000,
};

const sanitizeSettings = (input: Partial<BotSettings> | null | undefined): BotSettings => {
  const merged: BotSettings = {
    ...defaultSettings,
    ...(input || {}),
    responses: Array.isArray(input?.responses) ? input!.responses : defaultSettings.responses,
    targetGroups: Array.isArray(input?.targetGroups) ? input!.targetGroups : defaultSettings.targetGroups,
  };
  const cleanedTargets = Array.from(
    new Set((merged.targetGroups || []).map((t) => String(t || "").trim()).filter(Boolean))
  );
  return {
    ...merged,
    targetGroups: cleanedTargets,
    antiSpamDelay: Number.isFinite(Number(merged.antiSpamDelay))
      ? Number(merged.antiSpamDelay)
      : defaultSettings.antiSpamDelay,
  };
};

// ─── Per-account settings ────────────────────────────────────────────────────

const accountSettingsMap = new Map<string, BotSettings>();

const loadAccountSettings = () => {
  if (!fs.existsSync(ACCOUNT_SETTINGS_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(ACCOUNT_SETTINGS_FILE, "utf8"));
    if (typeof raw === "object" && !Array.isArray(raw)) {
      for (const [id, s] of Object.entries(raw)) {
        accountSettingsMap.set(String(id), sanitizeSettings(s as any));
      }
    }
  } catch {}
};

const saveAccountSettings = () => {
  const obj: Record<string, BotSettings> = {};
  for (const [id, s] of accountSettingsMap) obj[id] = s;
  fs.writeFileSync(ACCOUNT_SETTINGS_FILE, JSON.stringify(obj, null, 2));
};

const getAccountSettings = (accountId: string): BotSettings =>
  accountSettingsMap.get(accountId) || { ...defaultSettings };

const setAccountSettings = (accountId: string, settings: Partial<BotSettings>) => {
  const current = getAccountSettings(accountId);
  const updated = sanitizeSettings({ ...current, ...settings });
  accountSettingsMap.set(accountId, updated);
  saveAccountSettings();
  return updated;
};

loadAccountSettings();

// ─── Global settings (legacy fallback) ───────────────────────────────────────

let botSettings: BotSettings = defaultSettings;
if (fs.existsSync(SETTINGS_FILE)) {
  try {
    botSettings = sanitizeSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")));
  } catch {}
}
const saveSettings = () =>
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(botSettings, null, 2));

// ─── Accounts ────────────────────────────────────────────────────────────────

const accounts: AccountRecord[] = (() => {
  if (!fs.existsSync(ACCOUNTS_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item) => item?.accountId && item?.apiId && item?.apiHash && item?.sessionString)
      .map((item) => ({
        accountId: String(item.accountId),
        apiId: Number(item.apiId),
        apiHash: String(item.apiHash),
        sessionString: String(item.sessionString),
      }));
  } catch {
    return [];
  }
})();

const liveClients = new Map<string, TelegramClient>();
const pendingAuthByAccount = new Map<string, PendingAuthState>();

const upsertAccount = (record: AccountRecord) => {
  const idx = accounts.findIndex((a) => a.accountId === record.accountId);
  if (idx >= 0) accounts[idx] = record;
  else accounts.push(record);
};

const removeAccount = (accountId: string) => {
  const idx = accounts.findIndex((a) => a.accountId === accountId);
  if (idx >= 0) accounts.splice(idx, 1);
};

const saveAccounts = () =>
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));

// ─── Express + Socket.IO ─────────────────────────────────────────────────────

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
app.use(express.json());

const MAX_LOG_HISTORY = 200;
const logHistory: { message: string; type: "info" | "success" | "error" | "bot"; timestamp: string }[] = [];

const broadcastLog = (message: string, type: "info" | "success" | "error" | "bot" = "info") => {
  const entry = { message, type, timestamp: new Date().toLocaleTimeString() };
  logHistory.push(entry);
  if (logHistory.length > MAX_LOG_HISTORY) logHistory.splice(0, logHistory.length - MAX_LOG_HISTORY);
  io.emit("bot-log", entry);
  console.log(`[${type.toUpperCase()}] ${message}`);
};

io.on("connection", (socket) => {
  for (const entry of logHistory) socket.emit("bot-log", entry);
  socket.emit("bot-log", {
    message: `Dashboard tersambung. ${logHistory.length} log cached.`,
    type: "info",
    timestamp: new Date().toLocaleTimeString(),
  });
});

// ─── Utilities ────────────────────────────────────────────────────────────────

const normalizeTarget = (value: string) => value.trim().toLowerCase().replace(/^@/, "");

const normalizeNumericId = (value: string) => {
  const n = normalizeTarget(value);
  if (!/^-?\d+$/.test(n)) return n;
  return n.replace(/^-100/, "").replace(/^-/, "");
};

const normalizeForKeyword = (value: string) =>
  (value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const matchesSingleKeyword = (rawText: string, singleKeyword: string): boolean => {
  const k = singleKeyword.toLowerCase().trim();
  if (!k) return false;

  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  try {
    if (new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(rawText)) return true;
  } catch {}

  const nt = normalizeForKeyword(rawText);
  const nk = normalizeForKeyword(k);
  if (!nk) return false;
  try {
    const nEscaped = nk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![a-z0-9])${nEscaped}(?![a-z0-9])`).test(nt);
  } catch {}

  return false;
};

// Supports comma-separated keywords: "wtb, jual, roblox" matches any of the three
const containsKeyword = (rawText: string, keyword: string): string | false => {
  const parts = (keyword || "").split(",").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (matchesSingleKeyword(rawText, part)) return part;
  }
  return false;
};

const toIdVariants = (value: unknown): string[] => {
  if (value == null) return [];
  const raw = String(value).trim();
  if (!raw) return [];
  const numeric = raw.replace(/^-100/, "").replace(/^-/, "");
  if (!/^\d+$/.test(numeric)) return [raw];
  return Array.from(new Set([raw, numeric, `-${numeric}`, `-100${numeric}`]));
};

const linkedChatCache = new Map<string, string[]>();

const getLinkedChatCandidates = async (
  accountId: string,
  tgClient: TelegramClient,
  chat: any
): Promise<string[]> => {
  if (!chat || (chat.className !== "Channel" && chat.className !== "Chat")) return [];
  const key = `${accountId}:${chat.className}:${String(chat.id || "")}`;
  if (linkedChatCache.has(key)) return linkedChatCache.get(key)!;
  try {
    const full =
      chat.className === "Channel"
        ? await tgClient.invoke(new Api.channels.GetFullChannel({ channel: chat }))
        : await tgClient.invoke(new Api.messages.GetFullChat({ chatId: chat.id }));
    const linkedId = (full as any)?.fullChat?.linkedChatId;
    const candidates = toIdVariants(linkedId);
    linkedChatCache.set(key, candidates);
    return candidates;
  } catch {
    linkedChatCache.set(key, []);
    return [];
  }
};

const matchesConfiguredTarget = (
  accountId: string,
  message: any,
  sender: any,
  chat: any,
  extraCandidates: string[] = []
) => {
  const settings = getAccountSettings(accountId);
  if (settings.autoDetect) return true;
  const activeTargets = settings.targetGroups.map((t) => String(t || "").trim()).filter(Boolean);
  if (!activeTargets.length) return true;

  const candidates = [
    sender?.username,
    sender?.id ? String(sender.id) : "",
    chat?.title,
    message?.chat?.username,
    message?.chat?.title,
    message?.chat?.id ? String(message.chat.id) : "",
    message?.peerId?.channelId ? String(message.peerId.channelId) : "",
    message?.peerId?.chatId ? String(message.peerId.chatId) : "",
    ...extraCandidates,
  ]
    .filter(Boolean)
    .map(normalizeTarget);

  const numericCandidates = candidates.map(normalizeNumericId);

  return activeTargets.some((target) => {
    const nt = normalizeTarget(target);
    const nn = normalizeNumericId(target);
    return (
      candidates.includes(nt) ||
      candidates.some((c) => c.endsWith(nt)) ||
      numericCandidates.includes(nn) ||
      numericCandidates.some((c) => c.endsWith(nn))
    );
  });
};

// ─── Message Queue ────────────────────────────────────────────────────────────

const responseQueueByAccount = new Map<string, { targetId: any; replyTo: number; message: string }[]>();
const processingQueueAccounts = new Set<string>();
const queuedReplySet = new Set<string>();

const formatTargetId = (targetId: any) => {
  const channelId = targetId?.channelId ? String(targetId.channelId) : "";
  const chatId = targetId?.chatId ? String(targetId.chatId) : "";
  const userId = targetId?.userId ? String(targetId.userId) : "";
  const picked = channelId || chatId || userId || String(targetId || "");
  if (/^\d+$/.test(picked)) return `-100${picked}`;
  return picked;
};

const processQueue = async (accountId: string) => {
  const queue = responseQueueByAccount.get(accountId) || [];
  const client = liveClients.get(accountId);
  if (processingQueueAccounts.has(accountId) || queue.length === 0 || !client?.connected) return;

  processingQueueAccounts.add(accountId);
  const task = queue.shift();

  if (task) {
    try {
      await client.sendMessage(task.targetId, { message: task.message, replyTo: task.replyTo });
      broadcastLog(`[${accountId}] Pesan terkirim (replyTo: ${task.replyTo})`, "success");
      const delay = getAccountSettings(accountId).antiSpamDelay || 2000;
      await new Promise((r) => setTimeout(r, delay));
    } catch (err: any) {
      if (err.message?.includes("FLOOD_WAIT_")) {
        const secs = parseInt(err.message.match(/\d+/)?.[0] || "10");
        broadcastLog(`[${accountId}] Flood wait ${secs}s...`, "error");
        queue.unshift(task);
        await new Promise((r) => setTimeout(r, secs * 1000));
      } else if (err.message?.includes("CHAT_ADMIN_REQUIRED")) {
        broadcastLog(
          `[${accountId}] Butuh izin admin di ${formatTargetId(task.targetId)}`,
          "error"
        );
      } else {
        broadcastLog(`[${accountId}] Kirim gagal: ${err.message}`, "error");
      }
    }
  }

  processingQueueAccounts.delete(accountId);
  processQueue(accountId);
};

const addToQueue = (accountId: string, targetId: any, replyTo: number, message: string) => {
  const replyKey = `${accountId}:${replyTo}:${message}`;
  if (queuedReplySet.has(replyKey)) {
    broadcastLog(`[${accountId}] [SKIP] Duplikat reply ke msg #${replyTo} diabaikan`, "info");
    return;
  }
  queuedReplySet.add(replyKey);
  if (queuedReplySet.size > 2000) queuedReplySet.clear();

  if (!responseQueueByAccount.has(accountId)) responseQueueByAccount.set(accountId, []);
  const queue = responseQueueByAccount.get(accountId)!;
  queue.push({ targetId, replyTo, message });
  broadcastLog(`[${accountId}] Pesan di-queue (${queue.length} pending)`, "info");
  processQueue(accountId);
};

// ─── Message Processing ───────────────────────────────────────────────────────

const processedMessageKeys = new Set<string>();
const repliedThreadKeys = new Set<string>();
const pollCursorByTarget = new Map<string, number>();
const pollingTimerByAccount = new Map<string, NodeJS.Timeout>();
const pollingAccounts = new Set<string>();


const resolveReplyTarget = async (message: any, chat: any) => {
  try {
    const inputChat = await message?.getInputChat?.();
    if (inputChat) return inputChat;
  } catch {}
  if (chat) return chat;
  return message?.peerId;
};

// Returns the message ID of the channel post inside its linked discussion group.
// Channel post IDs and discussion group message IDs are different namespaces —
// using the wrong one causes Telegram to silently drop the replyTo and send a
// standalone message to the group feed instead of a proper comment.
const getDiscussionMsgId = async (
  tgClient: TelegramClient,
  channel: any,
  channelMsgId: number
): Promise<{ discussionMsgId: number; discussionChat: any } | null> => {
  try {
    const result: any = await tgClient.invoke(
      new Api.messages.GetDiscussionMessage({ peer: channel, msgId: channelMsgId })
    );
    const msgs: any[] = result?.messages || [];
    const chats: any[] = result?.chats || [];
    if (!msgs.length) return null;
    const discussionMsgId = Number(msgs[0]?.id || 0);
    if (!discussionMsgId) return null;
    // The discussion group is a non-broadcast chat in the chats list
    const discussionChat =
      chats.find((c: any) => c.megagroup) ||
      chats.find((c: any) => !c.broadcast) ||
      chats[0] || null;
    return { discussionMsgId, discussionChat };
  } catch {
    return null;
  }
};

const resolveDiscussionReplyTarget = async (
  accountId: string,
  tgClient: TelegramClient,
  chat: any
) => {
  try {
    const candidates = await getLinkedChatCandidates(accountId, tgClient, chat);
    for (const candidate of candidates) {
      try {
        return await tgClient.getEntity(candidate);
      } catch {}
    }
  } catch {}
  return resolveReplyTarget(null, chat);
};


const handleIncomingMessage = async (
  accountId: string,
  tgClient: TelegramClient,
  message: any,
  source: "event" | "poll"
) => {
  const settings = getAccountSettings(accountId);
  if (!settings.isActive || !message) return;

  const rawText = String(message.message || "").trim();
  if (!rawText) return;

  if (message.out) return;

  const sender: any = await message.getSender().catch(() => null);
  const chat: any = await message.getChat().catch(() => null);
  const peer: any = message?.peerId;
  const hasGroupPeer = Boolean(peer?.channelId || peer?.chatId);
  const isGroup = Boolean(
    hasGroupPeer || (chat && (chat.className === "Chat" || chat.className === "Channel"))
  );
  if (!isGroup) return;

  const replyMeta: any = (message as any)?.replyTo;
  const isFwd = Boolean((message as any)?.fwdFrom || (message as any)?.forward);
  const hasThread = Boolean(replyMeta?.replyToTopId || replyMeta?.replyToMsgId);
  const sourceClass = String(chat?.className || "");
  const fwdChannelPostIdEarly = Number((message as any)?.fwdFrom?.channelPost || 0);
  const isBroadcastChannel = Boolean((chat as any)?.broadcast);
  // peer.channelId is set for both broadcast channels AND megagroups — reliable even when chat=null
  const isChannelPeer = Boolean(peer?.channelId);

  if (!isBroadcastChannel && !isChannelPeer) {
    // Not from any channel peer — skip unless forwarded from a channel
    if (sourceClass !== "Channel" && !fwdChannelPostIdEarly && !isFwd) {
      broadcastLog(`[${accountId}] [SKIP] Bukan channel, class="${sourceClass}"`, "info");
      return;
    }
  }

  // Skip replies/comments in discussion megagroup (not forwarded channel posts)
  if (!isBroadcastChannel && isChannelPeer && chat?.megagroup && hasThread && !fwdChannelPostIdEarly) {
    broadcastLog(`[${accountId}] [SKIP] Komentar discussion group diabaikan`, "info");
    return;
  }

  // When a channel post is forwarded into a linked discussion group, Telegram sets
  // replyMeta.replyToTopId to the CHANNEL message ID — which is NOT a valid message ID
  // in the discussion group. In that case we must reply to the forwarded message itself.
  const isForwardedIntoDiscussion = isFwd && sourceClass !== "Channel";
  const threadTopId = isForwardedIntoDiscussion
    ? Number(message.id || 0)
    : (Number(replyMeta?.replyToTopId || 0) ||
       Number(replyMeta?.replyToMsgId || 0) ||
       Number(message.id || 0));

  // ── Canonical dedup key ──────────────────────────────────────────────────────
  // The same channel post can arrive via two paths with different IDs:
  //   • Event handler  → channel message   (peerId.channelId = channelId, id = postId)
  //   • Polling        → forwarded message  (peerId.channelId = groupId,   id = groupMsgId)
  // We normalise to the ORIGINAL channel post ID (fwdFrom.channelPost) so both
  // paths map to the same key and the second one is skipped.
  const fwdChannelPostId = Number((message as any)?.fwdFrom?.channelPost || 0);
  const fwdChannelId = String((message as any)?.fwdFrom?.fromId?.channelId || "");
  const canonicalPeerId = fwdChannelId || String(peer?.channelId || peer?.chatId || peer?.userId || "unknown");
  const canonicalMsgId = fwdChannelPostId || Number(message?.id || 0);
  const dedupeKey = `${accountId}:${canonicalPeerId}:${canonicalMsgId}`;
  if (processedMessageKeys.has(dedupeKey)) {
    broadcastLog(`[${accountId}] [DEDUP] Sudah diproses: ${dedupeKey}`, "info");
    return;
  }
  processedMessageKeys.add(dedupeKey);
  if (processedMessageKeys.size > 5000) processedMessageKeys.clear();

  const linkedCandidates = await getLinkedChatCandidates(accountId, tgClient, chat);
  if (!matchesConfiguredTarget(accountId, message, sender, chat, linkedCandidates)) {
    const possibleIds = [
      ...toIdVariants(chat?.id),
      ...toIdVariants(message?.chat?.id),
      ...toIdVariants(peer?.channelId),
      ...toIdVariants(peer?.chatId),
      ...linkedCandidates,
    ];
    const compactIds = Array.from(new Set(possibleIds.map(normalizeTarget)))
      .slice(0, 8)
      .join(", ") || "(kosong)";
    broadcastLog(
      `[${accountId}] [SKIP] Target tidak cocok. Kandidat: ${compactIds}`,
      "info"
    );
    return;
  }

  const msgText = rawText.toLowerCase();
  const normalizedMsgText = normalizeForKeyword(rawText);

  let detectedKeyword = "";
  let match = undefined;

  // 1. Kumpulkan semua kombinasi keyword (jika ada koma) beserta response aslinya
  const flattenedResponses: { keyword: string; originalResponse: any }[] = [];
  settings.responses.forEach((r) => {
    const parts = (r.keyword || "").split(",").map((p) => p.trim()).filter(Boolean);
    parts.forEach((part) => {
      flattenedResponses.push({ keyword: part, originalResponse: r });
    });
  });

  // 2. Urutkan dari keyword terpanjang ke terpendek
  flattenedResponses.sort((a, b) => b.keyword.length - a.keyword.length);

  // 3. Cek match dengan yang paling spesifik (paling panjang) duluan
  for (const item of flattenedResponses) {
    if (matchesSingleKeyword(msgText, item.keyword)) {
      detectedKeyword = item.keyword;
      match = item.originalResponse;
      break; // Berhenti di match pertama (yang terpanjang)
    }
  }

  if (!match) {
    broadcastLog(
      `[${accountId}] [SKIP] Tidak ada keyword cocok: "${normalizedMsgText.slice(0, 120)}"`,
      "info"
    );
    return;
  }

  // Use the same canonical IDs as dedupeKey so event-path and poll-path
  // for the same channel post share one threadKey and only one reply is sent.
  const threadKey = `${accountId}:${canonicalPeerId}:${canonicalMsgId}:${detectedKeyword || "custom"}`;
  if (repliedThreadKeys.has(threadKey)) return;

  repliedThreadKeys.add(threadKey);
  if (repliedThreadKeys.size > 10000) repliedThreadKeys.clear();

  broadcastLog(
    `[${accountId}] [TRIGGER][${source}] keyword="${detectedKeyword}" | teks="${rawText.slice(0, 100)}"`,
    "bot"
  );

  const finalResponse = match.response;

  try {
    let effectiveChat = chat;
    if (isFwd) {
      // In GramJS (MTProto), fwdFrom.fromId is a Peer object (e.g. PeerChannel).
      // fwdFrom.chat / forward_from_chat are Bot API fields that don't exist here.
      const fwdFromId = (message as any)?.fwdFrom?.fromId;
      if (fwdFromId) {
        try {
          const resolved = await tgClient.getEntity(fwdFromId);
          if (resolved) effectiveChat = resolved;
        } catch {}
      }
    }

    let replyTarget: any;
    let replyMsgId = threadTopId;

    if (String(effectiveChat?.className || "") === "Channel") {
      // Channel post: must use GetDiscussionMessage to get the valid message ID
      // inside the linked discussion group. Channel post IDs ≠ discussion message IDs,
      // so using the channel ID causes Telegram to ignore replyTo and post to the feed.
      const disc = await getDiscussionMsgId(tgClient, effectiveChat, threadTopId);
      if (disc) {
        replyTarget = disc.discussionChat
          || await resolveDiscussionReplyTarget(accountId, tgClient, effectiveChat);
        replyMsgId = disc.discussionMsgId;
        broadcastLog(`[${accountId}] [DISC] Reply di discussion msg #${replyMsgId}`, "info");
      } else {
        replyTarget = await resolveDiscussionReplyTarget(accountId, tgClient, effectiveChat);
      }
    } else {
      replyTarget = await resolveReplyTarget(message, chat);
    }

    const minDelay = 3000;
    const maxDelay = 8000;
    const randomDelay = minDelay + Math.floor(Math.random() * (maxDelay - minDelay));
    broadcastLog(`[${accountId}] Menunggu ${(randomDelay / 1000).toFixed(1)}s sebelum reply...`, "info");
    await new Promise((r) => setTimeout(r, randomDelay));

    addToQueue(accountId, replyTarget, replyMsgId, finalResponse);
  } catch (err: any) {
    broadcastLog(`[${accountId}] Error final execution: ${err.message}`, "error");
  }
};

// ─── Polling Fallback (uses per-account settings) ────────────────────────────

const startPollingFallback = (accountId: string, tgClient: TelegramClient) => {
  if (pollingTimerByAccount.has(accountId)) return;

  const timer = setInterval(async () => {
    const client = liveClients.get(accountId);
    const settings = getAccountSettings(accountId);
    if (pollingAccounts.has(accountId) || !client?.connected || !settings.isActive) return;
    pollingAccounts.add(accountId);

    try {
      const targets = settings.targetGroups.map((t) => String(t || "").trim()).filter(Boolean);
      for (const target of targets) {
        try {
          const entity: any = await tgClient.getEntity(target);
          let pollEntities: any[] = [entity];

          if (entity?.className === "Channel") {
            try {
              const full = await tgClient.invoke(
                new Api.channels.GetFullChannel({ channel: entity })
              );
              const linkedId = (full as any)?.fullChat?.linkedChatId;
              if (linkedId) {
                const linked: any = await tgClient.getEntity(`-100${String(linkedId)}`);
                pollEntities = [linked];
              }
            } catch {}
          }

          for (const pollEntity of pollEntities) {
            const list: any[] = (await tgClient.getMessages(pollEntity, { limit: 20 })) as any[];
            const sorted = [...(list || [])].sort(
              (a: any, b: any) => Number(a?.id || 0) - Number(b?.id || 0)
            );
            const targetKey = normalizeTarget(
              `${accountId}:${target}:${String(pollEntity?.id || "unknown")}`
            );
            const hasCursor = pollCursorByTarget.has(targetKey);
            const cursor = pollCursorByTarget.get(targetKey) || 0;
            let maxSeen = cursor;

            if (!hasCursor) {
              const latestId = sorted.length ? Number(sorted[sorted.length - 1]?.id || 0) : 0;
              pollCursorByTarget.set(targetKey, latestId);
              continue;
            }

            for (const msg of sorted) {
              const id = Number(msg?.id || 0);
              if (!id) continue;
              if (id <= cursor) {
                if (id > maxSeen) maxSeen = id;
                continue;
              }
              if (id > maxSeen) maxSeen = id;
              await handleIncomingMessage(accountId, tgClient, msg, "poll");
            }

            pollCursorByTarget.set(targetKey, maxSeen);
          }
        } catch {}
      }
    } finally {
      pollingAccounts.delete(accountId);
    }
  }, 6000);

  pollingTimerByAccount.set(accountId, timer);
};

const setupBotCore = (accountId: string, tgClient: TelegramClient) => {
  startPollingFallback(accountId, tgClient);
  tgClient.addEventHandler(async (event) => {
    await handleIncomingMessage(accountId, tgClient, event.message, "event");
  }, new NewMessage({}));
};

// ─── API Routes ───────────────────────────────────────────────────────────────

app.get("/api/config", (_req, res) => {
  const accountStatuses = accounts.map((a) => ({
    accountId: a.accountId,
    connected: liveClients.get(a.accountId)?.connected || false,
    hasSession: Boolean(a.sessionString),
    isActive: getAccountSettings(a.accountId).isActive,
  }));
  res.json({
    connected: accountStatuses.some((a) => a.connected),
    accounts: accountStatuses,
    settings: botSettings,
    hasSession: accountStatuses.some((a) => a.hasSession),
  });
});

app.get("/api/accounts", (_req, res) => {
  res.json({
    accounts: accounts.map((a) => ({
      accountId: a.accountId,
      connected: liveClients.get(a.accountId)?.connected || false,
      hasSession: Boolean(a.sessionString),
    })),
  });
});

app.get("/api/logs", (_req, res) => {
  res.json({ logs: [...logHistory].reverse() });
});

app.get("/api/account/:accountId/info", async (req, res) => {
  const accId = String(req.params.accountId || "").trim();
  const client = liveClients.get(accId);
  if (!client?.connected) return res.json({ phone: null, username: null, firstName: null, lastName: null });
  try {
    const me: any = await client.getMe();
    res.json({
      firstName: me?.firstName || null,
      lastName: me?.lastName || null,
      username: me?.username || null,
      phone: me?.phone || null,
    });
  } catch {
    res.json({ phone: null, username: null, firstName: null, lastName: null });
  }
});

app.post("/api/accounts/:accountId/rename", (req, res) => {
  const oldId = String(req.params.accountId || "").trim();
  const newId = String(req.body?.newId || "").trim();
  if (!oldId || !newId) return res.status(400).json({ error: "oldId dan newId wajib diisi" });
  if (oldId === newId) return res.status(400).json({ error: "Nama sama" });
  if (accounts.find((a) => a.accountId === newId)) return res.status(400).json({ error: "Nama sudah digunakan" });

  const account = accounts.find((a) => a.accountId === oldId);
  if (!account) return res.status(404).json({ error: "Akun tidak ditemukan" });

  account.accountId = newId;

  const client = liveClients.get(oldId);
  if (client) { liveClients.set(newId, client); liveClients.delete(oldId); }

  const acSettings = accountSettingsMap.get(oldId);
  if (acSettings) { accountSettingsMap.set(newId, acSettings); accountSettingsMap.delete(oldId); }

  const timer = pollingTimerByAccount.get(oldId);
  if (timer) { pollingTimerByAccount.set(newId, timer); pollingTimerByAccount.delete(oldId); }

  const queue = responseQueueByAccount.get(oldId);
  if (queue) { responseQueueByAccount.set(newId, queue); responseQueueByAccount.delete(oldId); }

  if (processingQueueAccounts.has(oldId)) { processingQueueAccounts.delete(oldId); processingQueueAccounts.add(newId); }
  if (pollingAccounts.has(oldId)) { pollingAccounts.delete(oldId); pollingAccounts.add(newId); }

  saveAccounts();
  saveAccountSettings();
  broadcastLog(`Akun "${oldId}" di-rename ke "${newId}".`, "info");
  res.json({ success: true, newId });
});

app.post("/api/settings", (req, res) => {
  botSettings = sanitizeSettings({ ...botSettings, ...req.body });
  saveSettings();
  res.json({ success: true });
});

app.get("/api/account/:accountId/settings", (req, res) => {
  const accId = String(req.params.accountId || "").trim();
  if (!accId) return res.status(400).json({ error: "accountId required" });
  res.json(getAccountSettings(accId));
});

app.post("/api/account/:accountId/settings", (req, res) => {
  const accId = String(req.params.accountId || "").trim();
  if (!accId) return res.status(400).json({ error: "accountId required" });
  const updated = setAccountSettings(accId, req.body);
  broadcastLog(`[${accId}] Pengaturan diperbarui.`, "info");
  res.json(updated);
});

// Resolve a Telegram target (username or ID) to get its real title and numeric ID
app.post("/api/account/:accountId/resolve-target", async (req, res) => {
  const accId = String(req.params.accountId || "").trim();
  const target = String(req.body?.target || "").trim();
  if (!accId || !target) {
    return res.status(400).json({ error: "accountId dan target wajib diisi" });
  }

  const client = liveClients.get(accId);
  if (!client?.connected) {
    return res.status(400).json({ error: "Akun tidak terkoneksi" });
  }

  try {
    const entity: any = await client.getEntity(target);
    const rawId = entity?.id ? String(entity.id) : "";
    const normalizedId = rawId ? `-100${rawId}` : target;
    res.json({
      id: normalizedId,
      rawId,
      title: entity?.title || entity?.firstName || entity?.username || target,
      type: entity?.className || "unknown",
      username: entity?.username || null,
      membersCount: entity?.participantsCount || null,
    });
  } catch (e: any) {
    res.status(400).json({ error: `Tidak bisa resolve: ${e.message}` });
  }
});

app.post("/api/tg/connect", async (req, res) => {
  const { accountId: rawAccountId, apiId, apiHash, phone } = req.body;
  const accountId = String(rawAccountId || "").trim();
  if (!accountId) return res.status(400).json({ error: "accountId wajib diisi" });
  if (!apiId || !apiHash || !phone) {
    return res.status(400).json({ error: "apiId, apiHash, dan phone wajib diisi" });
  }

  try {
    const oldPending = pendingAuthByAccount.get(accountId);
    if (oldPending) {
      await oldPending.client.disconnect().catch(() => undefined);
      pendingAuthByAccount.delete(accountId);
    }

    const tempClient = new TelegramClient(new StringSession(""), Number(apiId), String(apiHash), {
      connectionRetries: 5,
    });
    await tempClient.connect();
    const { phoneCodeHash } = await tempClient.sendCode(
      { apiId: Number(apiId), apiHash: String(apiHash) },
      String(phone)
    );

    pendingAuthByAccount.set(accountId, {
      accountId,
      apiId: Number(apiId),
      apiHash: String(apiHash),
      phone: String(phone),
      phoneCodeHash,
      client: tempClient,
    });

    broadcastLog(`[${accountId}] Kode OTP dikirim ke ${phone}`, "info");
    res.json({ success: true, phoneCodeHash });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/tg/verify", async (req, res) => {
  const { accountId: rawAccountId, phone, code, password } = req.body;
  const accountId = String(rawAccountId || "").trim();
  if (!accountId) return res.status(400).json({ error: "accountId wajib diisi" });

  const pending = pendingAuthByAccount.get(accountId);
  if (!pending) {
    return res.status(400).json({ error: "Belum ada sesi connect untuk akun ini" });
  }

  try {
    await pending.client.start({
      phoneNumber: async () => String(phone || pending.phone),
      phoneCode: async () => code,
      password: async () => password,
      onError: (e) => { throw e; },
    });

    const oldLive = liveClients.get(accountId);
    if (oldLive && oldLive !== pending.client) {
      await oldLive.disconnect().catch(() => undefined);
    }

    const oldTimer = pollingTimerByAccount.get(accountId);
    if (oldTimer) {
      clearInterval(oldTimer);
      pollingTimerByAccount.delete(accountId);
    }

    liveClients.set(accountId, pending.client);
    const sessionString = pending.client.session.save() as unknown as string;
    upsertAccount({
      accountId,
      apiId: pending.apiId,
      apiHash: pending.apiHash,
      sessionString,
    });
    saveAccounts();

    setupBotCore(accountId, pending.client);
    pendingAuthByAccount.delete(accountId);

    broadcastLog(`[${accountId}] Bot Online!`, "success");
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/accounts/:accountId", async (req, res) => {
  const accountId = String(req.params.accountId || "").trim();
  if (!accountId) return res.status(400).json({ error: "accountId tidak valid" });

  const client = liveClients.get(accountId);
  if (client) {
    await client.disconnect().catch(() => undefined);
    liveClients.delete(accountId);
  }

  const pending = pendingAuthByAccount.get(accountId);
  if (pending) {
    await pending.client.disconnect().catch(() => undefined);
    pendingAuthByAccount.delete(accountId);
  }

  const timer = pollingTimerByAccount.get(accountId);
  if (timer) {
    clearInterval(timer);
    pollingTimerByAccount.delete(accountId);
  }

  responseQueueByAccount.delete(accountId);
  processingQueueAccounts.delete(accountId);
  pollingAccounts.delete(accountId);
  removeAccount(accountId);
  saveAccounts();

  broadcastLog(`[${accountId}] Akun dihapus.`, "info");
  res.json({ success: true });
});

// ─── Auto-init on startup ─────────────────────────────────────────────────────

const autoInit = async () => {
  for (const account of accounts) {
    try {
      const client = new TelegramClient(
        new StringSession(account.sessionString),
        Number(account.apiId),
        String(account.apiHash),
        { connectionRetries: 5 }
      );
      await client.connect();
      if (await client.checkAuthorization()) {
        liveClients.set(account.accountId, client);
        setupBotCore(account.accountId, client);
        broadcastLog(`[${account.accountId}] Auto-reconnect sukses.`, "success");
      } else {
        broadcastLog(`[${account.accountId}] Session tidak valid.`, "error");
      }
    } catch {
      broadcastLog(`[${account.accountId}] Auto-reconnect gagal.`, "error");
    }
  }
};

autoInit();

// ─── Static / Vite Dev ────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== "production") {
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
} else {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
}

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`TeleOffer running on port ${PORT}`);
});
