import {
  clearPendingMessages,
  connectRoomSocket,
  disconnectRoomSocket,
  flushPendingMessages,
  isSocketConnected,
  queueRoomMessage,
  sendRoomMessage,
  setSocketMessageHandler,
} from './socket.js';
import { isSupportedWatchUrl, registry, resolveNavigateUrl, watchTargetKey } from '../../shared/providers/index.js';

import { isWebAppUrl, SESSION_STORAGE_KEY, type WatchSession } from '../../shared/session.js';
import {
  checkForExtensionUpdate,
  dismissExtensionUpdate,
  getExtensionUpdateInfo,
  initExtensionUpdateChecks,
} from './updates.js';

declare const __PW_DEFAULT_SERVER__: string;
declare const __PW_BUILTIN_WEB_ORIGINS__: string[];

const DEFAULT_SERVER = __PW_DEFAULT_SERVER__;
const BUILTIN_WEB_ORIGINS: string[] = __PW_BUILTIN_WEB_ORIGINS__;

function webAppOrigins(): string[] {
  const origins = [...BUILTIN_WEB_ORIGINS];
  if (state.serverUrl) {
    try {
      origins.push(new URL(state.serverUrl).origin);
    } catch {
      // ignore invalid server URL
    }
  }
  return origins;
}

interface StoredState {
  roomId: string | null;
  userName: string;
  userId: string | null;
  serverUrl: string;
  isHost: boolean;
}

interface RoomPayload {
  videoUrl: string | null;
  members: { id: string; isHost: boolean }[];
}

setSocketMessageHandler(handleServerMessage);

let lastOpenedWatchUrl: string | null = null;
let lastRoomVideoUrl: string | null = null;
let chatHistoryCache: ChatMessage[] = [];

interface SyncEvent {
  type: string;
  roomId: string;
  userId: string;
  timestamp?: number;
  videoUrl?: string;
  serverTime?: number;
}

interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  text: string;
  sentAt: number;
  reactions?: Record<string, string[]>;
}

let state: StoredState = {
  roomId: null,
  userName: 'Гость',
  userId: null,
  serverUrl: DEFAULT_SERVER,
  isHost: false,
};

browser.storage.local.get(['roomId', 'userName', 'userId', 'serverUrl', 'isHost']).then(async (stored) => {
  state = { ...state, ...stored };
  const sessionStored = await browser.storage.session.get('lastOpenedWatchUrl');
  lastOpenedWatchUrl = (sessionStored.lastOpenedWatchUrl as string | undefined) ?? null;
  if (state.roomId) connectSocket();
  await reinjectWebBridges();
  syncFromWebTabs();
  initExtensionUpdateChecks();
});

browser.runtime.onInstalled.addListener(() => {
  void reinjectWebBridges();
  initExtensionUpdateChecks();
});

async function reinjectWebBridges(): Promise<void> {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url || !isWebAppUrl(tab.url, webAppOrigins())) continue;
    injectedScripts.delete(tab.id);
    await ensureWebBridge(tab.id);
  }
}

browser.storage.onChanged.addListener((changes) => {
  if (changes.roomId || changes.userName || changes.serverUrl || changes.isHost) {
    browser.storage.local.get(['roomId', 'userName', 'userId', 'serverUrl', 'isHost']).then((stored) => {
      const prevRoom = state.roomId;
      state = { ...state, ...stored };
      if (state.roomId !== prevRoom) {
        disconnectSocket();
        if (state.roomId) connectSocket();
      }
    });
  }
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true;
});

async function handleMessage(
  message: Record<string, unknown>,
  sender: browser.Runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case 'get-state':
      await syncFromWebTabs();
      return { ...state, connected: isSocketConnected() };

    case 'get-update-info':
      return getExtensionUpdateInfo();

    case 'check-update':
      return checkForExtensionUpdate(true);

    case 'dismiss-update':
      await dismissExtensionUpdate(message.version as string);
      return { ok: true };

    case 'request-chat-history': {
      const tabId = sender.tab?.id;
      if (tabId) await syncChatToWatchTab(tabId);
      return { ok: Boolean(state.roomId) };
    }

    case 'sync-from-web':
      await syncFromWebTabs();
      return { ...state, connected: isSocketConnected() };

    case 'web-session':
      await applySession(message.session as WatchSession);
      return { ok: true };

    case 'web-session-cleared':
      await clearRoomState();
      return { ok: true };

    case 'join-room': {
      const roomId = (message.roomId as string).toUpperCase();
      const userName = (message.userName as string) || 'Гость';
      const userId = (message.userId as string | undefined) ?? state.userId;
      state.roomId = roomId;
      state.userName = userName;
      if (userId) state.userId = userId;
      await browser.storage.local.set({ roomId, userName, userId: state.userId });
      connectSocket();
      return { ok: true };
    }

    case 'leave-room': {
      await clearWebSessionInTabs();
      await clearRoomState();
      return { ok: true };
    }

    case 'local-sync': {
      if (!state.roomId) return { ok: false };
      const payload = {
        action: 'sync',
        sync: {
          type: message.eventType,
          roomId: state.roomId,
          userId: state.userId,
          timestamp: message.timestamp,
        },
      };
      if (!state.userId) {
        queueRoomMessage(payload);
        return { ok: false, error: 'not-joined' };
      }
      const sent = sendRoomMessage(payload);
      if (!sent) queueRoomMessage(payload);
      return { ok: sent || isSocketConnected() };
    }

    case 'request-sync-state': {
      if (!state.roomId || !state.userId) return { ok: false };
      sendWs({
        action: 'sync',
        sync: {
          type: 'sync-request',
          roomId: state.roomId,
          userId: state.userId,
        },
      });
      return { ok: true };
    }

    case 'local-navigate': {
      if (!state.roomId || !state.isHost) return { ok: false };
      const payload = {
        action: 'sync',
        sync: {
          type: 'navigate',
          roomId: state.roomId,
          userId: state.userId,
          videoUrl: message.url as string,
        },
      };
      if (!state.userId) return { ok: false };
      const sent = sendRoomMessage(payload);
      if (!sent) queueRoomMessage(payload);
      return { ok: sent || isSocketConnected() };
    }

    case 'local-chat': {
      if (!state.roomId || !state.userId) return { ok: false };
      const text = (message.text as string | undefined)?.trim();
      if (!text) return { ok: false };
      const sent = sendRoomMessage({ action: 'chat', text });
      return { ok: sent || isSocketConnected() };
    }

    case 'local-chat-reaction': {
      if (!state.roomId || !state.userId) return { ok: false };
      const messageId = message.messageId as string | undefined;
      const emoji = message.emoji as string | undefined;
      if (!messageId || !emoji) return { ok: false };
      const sent = sendRoomMessage({ action: 'chat-reaction', messageId, emoji });
      return { ok: sent || isSocketConnected() };
    }

    default:
      return { ok: false };
  }
}

async function clearWebSessionInTabs(): Promise<void> {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url || !isWebAppUrl(tab.url, webAppOrigins())) continue;
    try {
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: (key: string) => {
          localStorage.removeItem(key);
          window.dispatchEvent(new Event('pw-session-updated'));
        },
        args: [SESSION_STORAGE_KEY],
      });
    } catch {
      // ignore
    }
  }
}

async function clearRoomState(): Promise<void> {
  sendRoomMessage({ action: 'leave-room' });
  state.roomId = null;
  state.userId = null;
  state.isHost = false;
  lastOpenedWatchUrl = null;
  lastRoomVideoUrl = null;
  chatHistoryCache = [];
  clearPendingMessages();
  await browser.storage.local.set({ roomId: null, userId: null, isHost: false, lastPublishedWatchKey: null });
  await browser.storage.session.remove('lastOpenedWatchUrl');
  void broadcastToWatchTabs({ type: 'chat-clear' });
  disconnectSocket();
}

async function applySession(session: WatchSession): Promise<void> {
  const sameSession =
    state.roomId === session.roomId &&
    state.userId === session.userId &&
    state.isHost === session.isHost;

  state.roomId = session.roomId;
  state.userId = session.userId;
  state.userName = session.userName;
  state.isHost = session.isHost;
  state.serverUrl = session.serverUrl || DEFAULT_SERVER;

  await browser.storage.local.set({
    roomId: state.roomId,
    userId: state.userId,
    userName: state.userName,
    isHost: state.isHost,
    serverUrl: state.serverUrl,
  });

  if (!sameSession || !isSocketConnected()) {
    connectSocket();
  }
}

async function syncFromWebTabs(): Promise<void> {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url || !isWebAppUrl(tab.url, webAppOrigins())) continue;
    await ensureWebBridge(tab.id);
    try {
      const [result] = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => localStorage.getItem('pw-session'),
      });
      const raw = result?.result as string | null;
      if (!raw) continue;
      const session = JSON.parse(raw) as WatchSession;
      if (session?.roomId && session?.userId) {
        await applySession(session);
        return;
      }
    } catch {
      // ignore
    }
  }
}

function connectSocket() {
  if (!state.roomId) return;
  disconnectSocket();
  connectRoomSocket(state.serverUrl, {
    action: 'join-room',
    roomId: state.roomId,
    userName: state.userName,
    userId: state.userId ?? undefined,
  });
}

function disconnectSocket() {
  disconnectRoomSocket();
}

function sendWs(data: Record<string, unknown>) {
  sendRoomMessage(data);
}

function handleServerMessage(msg: Record<string, unknown>) {
  switch (msg.type) {
    case 'room-joined':
    case 'room-created': {
      const userId = msg.userId as string;
      state.userId = userId;
      const room = msg.room as RoomPayload | undefined;
      if (room) {
        updateHostFlag(room, userId);
        if (room.videoUrl) void maybeOpenWatchUrl(room.videoUrl);
      }
      browser.storage.local.set({ userId, isHost: state.isHost });
      flushPendingMessages();
      break;
    }
    case 'room-state': {
      const room = msg.room as RoomPayload;
      if (room && state.userId) updateHostFlag(room, state.userId);
      if (room?.videoUrl && !state.isHost && room.videoUrl !== lastRoomVideoUrl) {
        lastRoomVideoUrl = room.videoUrl;
        void pushNavigateToGuestTabs(room.videoUrl);
      }
      break;
    }
    case 'sync': {
      const sync = msg.sync as SyncEvent;
      if (sync.type === 'sync-request' && state.isHost) {
        void respondToSyncRequest();
        return;
      }
      if (sync.type === 'navigate' && sync.videoUrl && sync.userId !== state.userId) {
        void pushNavigateToGuestTabs(sync.videoUrl);
        return;
      }
      if (sync.userId === state.userId) return;
      broadcastToWatchTabs({ type: 'remote-sync', sync });
      break;
    }
    case 'chat': {
      const chat = msg.chat as ChatMessage | undefined;
      if (!chat) break;
      if (!chatHistoryCache.some((m) => m.id === chat.id)) {
        chatHistoryCache.push(chat);
        if (chatHistoryCache.length > 100) {
          chatHistoryCache.splice(0, chatHistoryCache.length - 100);
        }
      }
      void broadcastToWatchTabs({ type: 'chat-message', chat });
      break;
    }
    case 'chat-history': {
      const chatHistory = (msg.chatHistory as ChatMessage[] | undefined) ?? [];
      chatHistoryCache = [...chatHistory];
      void broadcastToWatchTabs({ type: 'chat-history', chatHistory });
      break;
    }
    case 'chat-reaction': {
      const messageId = msg.messageId as string | undefined;
      const reactions = msg.reactions as Record<string, string[]> | undefined;
      if (!messageId || reactions === undefined) break;
      const cached = chatHistoryCache.find((m) => m.id === messageId);
      if (cached) {
        cached.reactions =
          Object.keys(reactions).length > 0 ? reactions : undefined;
      }
      void broadcastToWatchTabs({ type: 'chat-reaction', messageId, reactions });
      break;
    }
  }
}

function updateHostFlag(
  room: { members: { id: string; isHost: boolean }[] },
  userId: string
): void {
  state.isHost = room.members.find((m) => m.id === userId)?.isHost ?? false;
  browser.storage.local.set({ isHost: state.isHost });
}

async function respondToSyncRequest(): Promise<void> {
  if (!state.roomId || !state.userId) return;

  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url || !isSupportedWatchUrl(tab.url)) continue;
    try {
      const player = (await browser.tabs.sendMessage(tab.id, {
        type: 'request-player-state',
      })) as { timestamp?: number; playing?: boolean } | null;
      if (!player) continue;

      const base = {
        roomId: state.roomId,
        userId: state.userId,
        timestamp: player.timestamp ?? 0,
      };

      sendWs({
        action: 'sync',
        sync: { ...base, type: player.playing ? 'play' : 'pause' },
      });
      return;
    } catch {
      injectedScripts.get(tab.id)?.delete('content.js');
    }
  }
}

function isSameWatchTarget(hostVideoUrl: string, tabUrl: string): boolean {
  if (!isSupportedWatchUrl(tabUrl)) return false;
  const target = resolveNavigateUrl(hostVideoUrl, tabUrl);
  return watchTargetKey(target) === watchTargetKey(tabUrl);
}

function urlHash(raw: string): string {
  try {
    return new URL(raw).hash;
  } catch {
    return '';
  }
}

async function pushNavigateToGuestTabs(hostVideoUrl: string): Promise<void> {
  if (state.isHost || !isSupportedWatchUrl(hostVideoUrl)) return;

  // Same path as play/pause — deliver directly to the player content script.
  await broadcastToWatchTabs({
    type: 'remote-sync',
    sync: { type: 'navigate', videoUrl: hostVideoUrl },
  });

  const tabs = await browser.tabs.query({});
  const watchTabs = tabs.filter((t) => t.url && isSupportedWatchUrl(t.url));

  if (watchTabs.length === 0) {
    const firstTarget = resolveNavigateUrl(hostVideoUrl, hostVideoUrl);
    lastOpenedWatchUrl = firstTarget;
    lastRoomVideoUrl = hostVideoUrl;
    await browser.storage.session.set({ lastOpenedWatchUrl: firstTarget });
    const tab = await browser.tabs.create({ url: firstTarget, active: true });
    if (tab.id) await ensureContentScript(tab.id);
    return;
  }

  for (const tab of watchTabs) {
    if (!tab.id || !tab.url) continue;
    const tabTarget = resolveNavigateUrl(hostVideoUrl, tab.url);
    const tabHash = urlHash(tab.url);
    const targetHash = urlHash(tabTarget);

    lastOpenedWatchUrl = tabTarget;
    lastRoomVideoUrl = hostVideoUrl;
    await browser.storage.session.set({ lastOpenedWatchUrl: tabTarget });

    if (tab.url === tabTarget) continue;

    // Episode/season switch on the same series page.
    if (targetHash && tabHash !== targetHash) {
      injectedScripts.delete(tab.id);
      await deliverToWatchTab(tab.id, {
        type: 'remote-sync',
        sync: { type: 'navigate', videoUrl: hostVideoUrl },
      });
      try {
        await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: (url: string) => {
            location.assign(url);
          },
          args: [tabTarget],
        });
      } catch {
        await browser.tabs.update(tab.id, { url: tabTarget });
      }
      continue;
    }

    injectedScripts.delete(tab.id);
    await browser.tabs.update(tab.id, { url: tabTarget });
  }
}

async function maybeOpenWatchUrl(hostVideoUrl: string): Promise<void> {
  if (state.isHost || !isSupportedWatchUrl(hostVideoUrl)) return;

  const tabs = await browser.tabs.query({});
  const watchTab = tabs.find((t) => t.url && isSupportedWatchUrl(t.url));
  const targetUrl = watchTab?.url
    ? resolveNavigateUrl(hostVideoUrl, watchTab.url)
    : hostVideoUrl;

  if (watchTab?.url && isSameWatchTarget(hostVideoUrl, watchTab.url)) {
    lastOpenedWatchUrl = targetUrl;
    await browser.storage.session.set({ lastOpenedWatchUrl: targetUrl });
    if (watchTab.id) await ensureContentScript(watchTab.id);
    return;
  }

  if (lastOpenedWatchUrl === targetUrl) return;
  lastOpenedWatchUrl = targetUrl;
  await browser.storage.session.set({ lastOpenedWatchUrl: targetUrl });

  if (watchTab?.id) {
    await browser.tabs.update(watchTab.id, { url: targetUrl, active: true });
    await ensureContentScript(watchTab.id);
    return;
  }

  const tab = await browser.tabs.create({ url: targetUrl, active: true });
  if (tab.id) await ensureContentScript(tab.id);
}

async function syncChatToWatchTab(tabId: number): Promise<void> {
  if (!state.roomId) return;
  await deliverToWatchTab(tabId, { type: 'chat-history', chatHistory: [...chatHistoryCache] });
}

async function broadcastToWatchTabs(message: Record<string, unknown>) {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url || !isSupportedWatchUrl(tab.url)) continue;
    await deliverToWatchTab(tab.id, message);
  }
}

async function deliverToWatchTab(tabId: number, message: Record<string, unknown>) {
  await ensureContentScript(tabId);
  try {
    await browser.tabs.sendMessage(tabId, message);
  } catch {
    injectedScripts.get(tabId)?.delete('content.js');
    await ensureContentScript(tabId);
    await browser.tabs.sendMessage(tabId, message).catch(() => {});
  }
}

const injectedScripts = new Map<number, Set<string>>();

async function injectScript(tabId: number, file: string): Promise<void> {
  const injected = injectedScripts.get(tabId) ?? new Set();
  if (injected.has(file)) return;
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [file] });
    injected.add(file);
    injectedScripts.set(tabId, injected);
  } catch {
    injected.add(file);
    injectedScripts.set(tabId, injected);
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  await injectScript(tabId, 'content.js');
}

async function ensureWebBridge(tabId: number): Promise<void> {
  await injectScript(tabId, 'web-bridge.js');
}

browser.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'loading') {
    injectedScripts.delete(tabId);
  }
  if (info.status !== 'complete' || !tab.url) return;
  if (isWebAppUrl(tab.url, webAppOrigins())) {
    ensureWebBridge(tabId);
    syncFromWebTabs();
  } else if (registry.matchUrl(tab.url)) {
    void ensureContentScript(tabId).then(() => syncChatToWatchTab(tabId));
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  injectedScripts.delete(tabId);
});
