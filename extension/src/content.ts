import { clickEpisodeByHash, hdrezkaProvider, episodeUrlFromElement } from '../../shared/providers/hdrezka.js';
import { registry } from '../../shared/providers/index.js';
import { createChatOverlay } from './chat-overlay.js';

const matchedProvider = registry.matchUrl(location.href);
if (!matchedProvider) {
  // Not an HDRezka mirror — skip.
} else if ((globalThis as { __pwInjected?: boolean }).__pwInjected) {
  // already running on this page
} else {
  (globalThis as { __pwInjected?: boolean }).__pwInjected = true;
  startContentScript(matchedProvider);
}

function startContentScript(activeProvider: typeof hdrezkaProvider) {
const provider = activeProvider;
let isRemoteUpdate = false;
let isHost = false;
let videoEl: HTMLVideoElement | null = null;
let observer: MutationObserver | null = null;
let overlayEl: HTMLDivElement | null = null;
let lastWatchKey = '';
let lastVideoSrc = '';
let navigateBaselineReady = false;
let currentUserId: string | null = null;
let currentRoomId: string | null = null;

const chatOverlay = createChatOverlay({
  getUserId: () => currentUserId,
  getRoomId: () => currentRoomId,
});

const SYNC_THRESHOLD = 2;

const LAST_PUBLISHED_KEY = 'lastPublishedWatchKey';

function init() {
  findVideo();
  setupObserver();
  watchNavigation();
  setupEpisodeClicks();
  setupEpisodeListObserver();
  createOverlay();
  browser.runtime.onMessage.addListener(handleMessage);
  void initHostNavigateTracking();
  void initChatSession();
}

async function initChatSession() {
  try {
    const res = (await browser.runtime.sendMessage({ type: 'get-state' })) as {
      roomId?: string | null;
      userId?: string | null;
      isHost?: boolean;
    } | null;

    if (res?.userId) currentUserId = res.userId;
    if (res?.roomId) {
      currentRoomId = res.roomId;
      chatOverlay.setRoomId(currentRoomId);
      const role = res.isHost ? 'Хост' : 'Гость';
      updateOverlay(`${role} · ${res.roomId}`);
      await browser.runtime.sendMessage({ type: 'request-chat-history' });
      return;
    }
  } catch {
    // Extension context may be invalid — fall back to storage.
  }

  const stored = await browser.storage.local.get(['roomId', 'isHost', 'userId']);
  currentUserId = (stored.userId as string | undefined) ?? null;
  currentRoomId = (stored.roomId as string | undefined) ?? null;
  chatOverlay.setRoomId(currentRoomId);
  if (stored.roomId) {
    const role = stored.isHost ? 'Хост' : 'Гость';
    updateOverlay(`${role} · ${stored.roomId}`);
    try {
      await browser.runtime.sendMessage({ type: 'request-chat-history' });
    } catch {
      // ignore
    }
  }
}

async function initHostNavigateTracking() {
  const stored = await browser.storage.local.get(['isHost', 'roomId', LAST_PUBLISHED_KEY]);
  isHost = Boolean(stored.isHost);

  if (!stored.isHost || !stored.roomId) {
    markNavigateBaseline();
    return;
  }

  const url = captureWatchUrl();
  const key = provider.watchTargetKey(url);
  const prevKey = stored[LAST_PUBLISHED_KEY] as string | undefined;

  if (prevKey && prevKey !== key) {
    lastWatchKey = key;
    navigateBaselineReady = true;
    notifyNavigate(url);
    return;
  }

  lastWatchKey = key;
  navigateBaselineReady = true;
  if (!prevKey) {
    await browser.storage.local.set({ [LAST_PUBLISHED_KEY]: key });
  }
}

init();

function markNavigateBaseline() {
  const url = captureWatchUrl();
  lastWatchKey = provider.watchTargetKey(url);
  navigateBaselineReady = true;
}

browser.storage.onChanged.addListener((changes) => {
  if (changes.isHost) {
    isHost = Boolean(changes.isHost.newValue);
    if (isHost) void initHostNavigateTracking();
  }
  if (changes.roomId?.newValue) {
    currentRoomId = (changes.roomId.newValue as string | null | undefined) ?? null;
    chatOverlay.setRoomId(currentRoomId);
    updateOverlay(`Комната: ${changes.roomId.newValue}`);
    navigateBaselineReady = false;
    if (changes.roomId.newValue) {
      void initHostNavigateTracking();
    } else {
      browser.storage.local.remove(LAST_PUBLISHED_KEY);
      chatOverlay.clear();
    }
  }
  if (changes.userId) {
    currentUserId = (changes.userId.newValue as string | null | undefined) ?? null;
  }
});

function setupObserver() {
  observer = new MutationObserver(() => {
    if (!videoEl || !document.contains(videoEl)) {
      findVideo();
    }
    checkVideoSrcChange();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function watchNavigation() {
  window.addEventListener('hashchange', onWatchTargetMaybeChanged);
  window.addEventListener('popstate', onWatchTargetMaybeChanged);

  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);

  history.pushState = (...args) => {
    origPush(...args);
    onWatchTargetMaybeChanged();
  };
  history.replaceState = (...args) => {
    origReplace(...args);
    onWatchTargetMaybeChanged();
  };
}

function setupEpisodeListObserver() {
  const targets = [
    '.b-simple_episodes__list',
    '.b-simple_seasons__list',
    '#simple-seasons-tabs',
    '#simple-episodes-tabs',
    '.b-player',
  ];

  for (const selector of targets) {
    const node = document.querySelector(selector);
    if (!node) continue;
    new MutationObserver(() => {
      if (!isHost || !navigateBaselineReady || isRemoteUpdate) return;
      const url = captureWatchUrl();
      const key = provider.watchTargetKey(url);
      if (key !== lastWatchKey) notifyNavigate(url);
    }).observe(node, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-episode_id', 'data-season_id', 'data-episode-id', 'data-season-id'],
    });
  }
}

function setupEpisodeClicks() {
  document.addEventListener(
    'click',
    (e) => {
      if (!isHost) return;
      const el = (e.target as Element).closest(provider.episodeSelectors);
      if (!el) return;

      const immediateUrl = episodeUrlFromElement(el, location.href);
      scheduleNavigateCheck();
      if (immediateUrl) {
        for (const delay of [100, 300, 700, 1200, 2000]) {
          setTimeout(() => tryPublishEpisode(immediateUrl), delay);
        }
      }
    },
    true
  );
}

function tryPublishEpisode(url: string) {
  if (!isHost || isRemoteUpdate) return;
  const key = provider.watchTargetKey(url);
  if (key === lastWatchKey) return;
  notifyNavigate(url);
}

function scheduleNavigateCheck() {
  for (const delay of [100, 300, 700, 1200, 2000, 3500]) {
    setTimeout(() => {
      onWatchTargetMaybeChanged();
      tryPublishEpisode(captureWatchUrl());
    }, delay);
  }
}

function captureWatchUrl(): string {
  if (provider.buildWatchUrl) return provider.buildWatchUrl(location.href);
  return location.href;
}

function onWatchTargetMaybeChanged() {
  if (!isHost || isRemoteUpdate || !navigateBaselineReady) return;

  const url = captureWatchUrl();
  const key = provider.watchTargetKey(url);
  if (key !== lastWatchKey) {
    notifyNavigate(url);
  }
}

function checkVideoSrcChange() {
  if (!isHost || isRemoteUpdate || !videoEl?.src || !navigateBaselineReady) return;
  if (lastVideoSrc && videoEl.src !== lastVideoSrc) {
    notifyNavigate(captureWatchUrl());
  }
  lastVideoSrc = videoEl.src;
}

function notifyNavigate(url = captureWatchUrl()) {
  const fresh = captureWatchUrl();
  const finalUrl = (() => {
    try {
      const built = provider.buildWatchUrl ? provider.buildWatchUrl(url) : url;
      const builtUrl = new URL(built);
      if (builtUrl.hash) return built;
      const freshUrl = new URL(fresh);
      if (freshUrl.hash) return fresh;
      const passed = new URL(url);
      if (passed.hash) {
        return `${freshUrl.origin}${freshUrl.pathname}${freshUrl.search}${passed.hash}`;
      }
      return fresh;
    } catch {
      return fresh;
    }
  })();

  const key = provider.watchTargetKey(finalUrl);
  lastWatchKey = key;
  navigateBaselineReady = true;
  browser.storage.local.set({ [LAST_PUBLISHED_KEY]: key });
  browser.runtime
    .sendMessage({ type: 'local-navigate', url: finalUrl })
    .then((res: { ok?: boolean } | undefined) => {
      updateOverlay(res?.ok ? '📺 Серия переключена' : '⚠ Не удалось переключить');
    })
    .catch(() => updateOverlay('⚠ Не удалось переключить'));
}

function findVideo() {
  const candidates = provider.videoSelectors.flatMap((selector) =>
    [...document.querySelectorAll<HTMLVideoElement>(selector)]
  );

  for (const v of candidates) {
    if (!document.contains(v)) continue;

    if (videoEl !== v) {
      detachListeners();
      videoEl = v;
      attachListeners();
      if (v.src) lastVideoSrc = v.src;

      if (!v.duration || !Number.isFinite(v.duration)) {
        v.addEventListener('loadedmetadata', onVideoReady, { once: true });
        v.addEventListener('canplay', onVideoReady, { once: true });
        continue;
      }

      onVideoReady();
    }
    return;
  }
}

function onVideoReady() {
  if (!videoEl) return;
  reportPlayerPresence(true);
  updateOverlay('Подключено к плееру');
  browser.runtime.sendMessage({ type: 'request-sync-state' }).catch(() => {});
}

window.addEventListener('pagehide', () => reportPlayerPresence(false));

function attachListeners() {
  if (!videoEl) return;
  videoEl.addEventListener('play', onPlay);
  videoEl.addEventListener('pause', onPause);
  videoEl.addEventListener('seeked', onSeeked);
  videoEl.addEventListener('waiting', onWaiting);
  videoEl.addEventListener('canplay', onBufferEnd);
  videoEl.addEventListener('playing', onBufferEnd);
}

function detachListeners() {
  if (!videoEl) return;
  videoEl.removeEventListener('play', onPlay);
  videoEl.removeEventListener('pause', onPause);
  videoEl.removeEventListener('seeked', onSeeked);
  videoEl.removeEventListener('waiting', onWaiting);
  videoEl.removeEventListener('canplay', onBufferEnd);
  videoEl.removeEventListener('playing', onBufferEnd);
}

let lastSentTime = 0;
let isBuffering = false;
let reportedOnPlayer = false;

function reportPlayerPresence(onPlayer: boolean) {
  if (onPlayer === reportedOnPlayer) return;
  reportedOnPlayer = onPlayer;
  browser.runtime.sendMessage({ type: 'player-presence', onPlayer }).catch(() => {});
}

function onWaiting() {
  if (isRemoteUpdate || !videoEl || isBuffering) return;
  isBuffering = true;
  browser.runtime.sendMessage({ type: 'local-buffer', buffering: true }).catch(() => {});
  updateOverlay('⏳ Буферизация — ждём всех');
}

function onBufferEnd() {
  if (!isBuffering) return;
  isBuffering = false;
  browser.runtime.sendMessage({ type: 'local-buffer', buffering: false }).catch(() => {});
}

function onPlay() {
  if (isRemoteUpdate || !videoEl) return;
  sendSync('play', videoEl.currentTime);
}

function onPause() {
  if (isRemoteUpdate || !videoEl) return;
  sendSync('pause', videoEl.currentTime);
}

function onSeeked() {
  if (isRemoteUpdate || !videoEl) return;
  sendSync('seek', videoEl.currentTime);
}

function sendSync(eventType: string, timestamp: number) {
  if (Math.abs(timestamp - lastSentTime) < 0.5 && eventType === 'seek') return;
  lastSentTime = timestamp;
  browser.runtime
    .sendMessage({ type: 'local-sync', eventType, timestamp })
    .then((res: { ok?: boolean } | undefined) => {
      if (res?.ok) {
        const labels: Record<string, string> = {
          play: '▶ Синхронизировано',
          pause: '⏸ Синхронизировано',
          seek: '⏩ Синхронизировано',
        };
        updateOverlay(labels[eventType] ?? '🔄 Синхронизировано');
      } else {
        updateOverlay('⚠ Нет связи с сервером');
      }
    })
    .catch(() => updateOverlay('⚠ Нет связи с сервером'));
}

function handleMessage(message: Record<string, unknown>) {
  if (message.type === 'request-player-state') {
    if (!videoEl) return null;
    return {
      timestamp: videoEl.currentTime,
      playing: !videoEl.paused && !videoEl.ended,
    };
  }
  if (
    message.type === 'chat-message' ||
    message.type === 'chat-history' ||
    message.type === 'chat-reaction' ||
    message.type === 'chat-clear'
  ) {
    chatOverlay.handleMessage(message);
    return;
  }
  if (message.type === 'connection-status') {
    const status = message.status as string;
    if (status === 'reconnecting') updateOverlay('⚠ Переподключение...');
    else if (status === 'connected') updateOverlay('Связь восстановлена');
    return;
  }
  if (message.type === 'room-updated') {
    const room = message.room as { waitingBuffer?: boolean; members?: { name: string; buffering?: boolean }[] } | undefined;
    if (room?.waitingBuffer) {
      const names = room.members?.filter((m) => m.buffering).map((m) => m.name).join(', ');
      updateOverlay(names ? `⏳ Ждём: ${names}` : '⏳ Ждём загрузки');
    }
    return;
  }
  if (message.type !== 'remote-sync') return;
  applyRemoteSync(message.sync as RemoteSync);
}

interface RemoteSync {
  type: string;
  timestamp?: number;
  videoUrl?: string;
}

function applyRemoteSync(sync: RemoteSync) {
  if (sync.type === 'navigate' && sync.videoUrl) {
    const target = provider.resolveNavigateUrl(sync.videoUrl, location.href);
    if (target === location.href) return;

    isRemoteUpdate = true;
    updateOverlay('📺 Переключение серии...');

    try {
      const targetUrl = new URL(target);
      const currentUrl = new URL(location.href);
      const samePage = targetUrl.pathname === currentUrl.pathname;

      if (samePage && targetUrl.hash && clickEpisodeByHash(targetUrl.hash)) {
        setTimeout(() => {
          isRemoteUpdate = false;
        }, 2000);
        return;
      }

      if (samePage && targetUrl.hash) {
        location.assign(
          `${currentUrl.origin}${currentUrl.pathname}${currentUrl.search}${targetUrl.hash}`
        );
      } else {
        location.assign(target);
      }
    } catch {
      location.assign(target);
    }

    setTimeout(() => {
      isRemoteUpdate = false;
    }, 2000);
    return;
  }

  if (!videoEl) {
    findVideo();
    if (!videoEl) return;
  }

  isRemoteUpdate = true;

  try {
    switch (sync.type) {
      case 'play':
        if (
          sync.timestamp !== undefined &&
          Math.abs(videoEl.currentTime - sync.timestamp) > SYNC_THRESHOLD
        ) {
          videoEl.currentTime = sync.timestamp;
        }
        videoEl.play().catch(() => {});
        updateOverlay('▶ Синхронизация: воспроизведение');
        break;
      case 'pause':
        if (sync.timestamp !== undefined) videoEl.currentTime = sync.timestamp;
        videoEl.pause();
        updateOverlay('⏸ Синхронизация: пауза');
        break;
      case 'seek':
        if (sync.timestamp !== undefined) videoEl.currentTime = sync.timestamp;
        updateOverlay(`⏩ Синхронизация: ${formatTime(sync.timestamp ?? 0)}`);
        break;
      case 'sync-state':
        if (
          sync.timestamp !== undefined &&
          Math.abs(videoEl.currentTime - sync.timestamp) > SYNC_THRESHOLD
        ) {
          videoEl.currentTime = sync.timestamp;
        }
        updateOverlay('🔄 Синхронизировано');
        break;
      case 'sync-request':
        break;
    }
  } finally {
    setTimeout(() => {
      isRemoteUpdate = false;
    }, 500);
  }
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function createOverlay() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'pw-overlay';
  Object.assign(overlayEl.style, {
    position: 'fixed',
    bottom: '80px',
    right: '20px',
    padding: '8px 16px',
    background: 'rgba(108, 92, 231, 0.9)',
    color: '#fff',
    borderRadius: '8px',
    fontSize: '13px',
    fontFamily: 'Inter, system-ui, sans-serif',
    zIndex: '999999',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.3s',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  });
  document.body.appendChild(overlayEl);
}

let overlayTimer: ReturnType<typeof setTimeout> | null = null;

function updateOverlay(text: string) {
  if (!overlayEl) return;
  overlayEl.textContent = text;
  overlayEl.style.opacity = '1';
  if (overlayTimer) clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => {
    if (overlayEl) overlayEl.style.opacity = '0';
  }, 2500);
}
}
