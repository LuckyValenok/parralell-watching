import type { ExtensionUpdateInfo } from '../../shared/extension-release.js';

const roomInput = document.getElementById('room') as HTMLInputElement;
const nameInput = document.getElementById('name') as HTMLInputElement;
const passwordInput = document.getElementById('password') as HTMLInputElement;
const connectBtn = document.getElementById('connect') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnect') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const roleEl = document.getElementById('role') as HTMLParagraphElement;
const versionEl = document.getElementById('version') as HTMLSpanElement;
const updateBanner = document.getElementById('update-banner') as HTMLDivElement;
const updateText = document.getElementById('update-text') as HTMLParagraphElement;
const updateDownload = document.getElementById('update-download') as HTMLAnchorElement;
const updateDismiss = document.getElementById('update-dismiss') as HTMLButtonElement;
const connBanner = document.getElementById('conn-banner') as HTMLDivElement;
const membersPanel = document.getElementById('members-panel') as HTMLDivElement;
const membersList = document.getElementById('members-list') as HTMLUListElement;

type RoomMember = {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  buffering?: boolean;
  onPlayer?: boolean;
};

type PopupState = {
  userName?: string;
  roomId?: string | null;
  isHost?: boolean;
  connected?: boolean;
  socketStatus?: string;
  room?: { members: RoomMember[]; waitingBuffer?: boolean };
};

let currentUserId: string | null = null;

function showConnBanner(status?: string) {
  if (status === 'reconnecting') {
    connBanner.textContent = 'Переподключение к серверу...';
    connBanner.hidden = false;
    connBanner.classList.remove('hidden');
    return;
  }
  connBanner.hidden = true;
  connBanner.classList.add('hidden');
}

function renderMembers(state: PopupState) {
  const members = state.room?.members ?? [];
  if (!state.roomId || members.length === 0) {
    membersPanel.hidden = true;
    membersPanel.classList.add('hidden');
    return;
  }

  membersPanel.hidden = false;
  membersPanel.classList.remove('hidden');
  membersList.replaceChildren();

  for (const m of members) {
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'member-meta';

    const name = document.createElement('span');
    name.textContent = m.name;
    meta.appendChild(name);

    if (m.isHost) {
      const badge = document.createElement('span');
      badge.className = 'member-badge';
      badge.textContent = 'хост';
      meta.appendChild(badge);
    }
    if (m.onPlayer) {
      const tag = document.createElement('span');
      tag.className = 'member-tag';
      tag.textContent = 'плеер';
      meta.appendChild(tag);
    }
    if (m.buffering) {
      const tag = document.createElement('span');
      tag.className = 'member-tag';
      tag.textContent = 'буфер';
      meta.appendChild(tag);
    }

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.alignItems = 'center';
    actions.style.gap = '6px';

    if (state.isHost && m.id !== currentUserId && m.connected) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'host-btn';
      btn.textContent = '→ хост';
      btn.addEventListener('click', () => {
        void browser.runtime.sendMessage({ type: 'transfer-host', targetUserId: m.id });
      });
      actions.appendChild(btn);
    }

    const dot = document.createElement('span');
    dot.className = `dot-sm ${m.connected ? 'online' : 'offline'}`;
    actions.appendChild(dot);

    li.append(meta, actions);
    membersList.appendChild(li);
  }
}

function updateUi(state: PopupState) {
  if (state.userName) nameInput.value = state.userName;
  if (state.roomId) roomInput.value = state.roomId;

  showConnBanner(state.socketStatus);
  renderMembers(state);

  if (state.roomId) {
    const role = state.isHost ? 'Хост' : 'Гость';
    const conn = state.connected ? '' : ' · нет связи';
    statusEl.textContent = `${role} · ${state.roomId}${conn}`;
    statusEl.className = `status ${state.connected ? 'connected' : 'disconnected'}`;
    roleEl.textContent = state.isHost
      ? 'Управление синхронизируется с друзьями'
      : 'Следуете за хостом';
    connectBtn.classList.add('hidden');
    disconnectBtn.classList.remove('hidden');
    return;
  }

  statusEl.textContent = 'Не подключено';
  statusEl.className = 'status disconnected';
  roleEl.textContent = 'Создайте комнату на сайте или подключитесь вручную';
  connectBtn.classList.remove('hidden');
  disconnectBtn.classList.add('hidden');
}

function showUpdateBanner(info: ExtensionUpdateInfo) {
  if (!info.hasUpdate || !info.latestVersion) {
    updateBanner.hidden = true;
    updateBanner.classList.add('hidden');
    return;
  }

  updateText.textContent = `Доступна версия ${info.latestVersion} (у вас ${info.currentVersion}).`;
  updateDownload.href = info.downloadUrl || info.releaseUrl || '#';
  updateBanner.hidden = false;
  updateBanner.classList.remove('hidden');
}

async function refreshState() {
  const state = (await browser.runtime.sendMessage({ type: 'sync-from-web' })) as PopupState & {
    userId?: string;
  };
  currentUserId = state.userId ?? null;
  updateUi(state);
}

async function refreshUpdateInfo() {
  const info = (await browser.runtime.sendMessage({
    type: 'check-update',
  })) as ExtensionUpdateInfo;
  versionEl.textContent = info.currentVersion;
  showUpdateBanner(info);
}

connectBtn.addEventListener('click', async () => {
  const roomId = roomInput.value.trim().toUpperCase();
  const userName = nameInput.value.trim() || 'Гость';
  const password = passwordInput.value.trim();
  if (roomId.length < 4) return;

  await browser.runtime.sendMessage({
    type: 'join-room',
    roomId,
    userName,
    password: password || undefined,
  });
  await refreshState();
});

disconnectBtn.addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'leave-room' });
  const state = await browser.runtime.sendMessage({ type: 'get-state' });
  updateUi(state);
});

updateDismiss.addEventListener('click', async () => {
  const info = (await browser.runtime.sendMessage({
    type: 'get-update-info',
  })) as ExtensionUpdateInfo;
  if (info.latestVersion) {
    await browser.runtime.sendMessage({
      type: 'dismiss-update',
      version: info.latestVersion,
    });
  }
  updateBanner.hidden = true;
  updateBanner.classList.add('hidden');
});

roomInput.addEventListener('input', () => {
  roomInput.value = roomInput.value.toUpperCase();
});

void refreshState();
void refreshUpdateInfo();

setInterval(() => void refreshState(), 5000);
