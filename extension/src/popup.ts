import type { ExtensionUpdateInfo } from '../../shared/extension-release.js';

const roomInput = document.getElementById('room') as HTMLInputElement;
const nameInput = document.getElementById('name') as HTMLInputElement;
const connectBtn = document.getElementById('connect') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnect') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const roleEl = document.getElementById('role') as HTMLParagraphElement;
const versionEl = document.getElementById('version') as HTMLSpanElement;
const updateBanner = document.getElementById('update-banner') as HTMLDivElement;
const updateText = document.getElementById('update-text') as HTMLParagraphElement;
const updateDownload = document.getElementById('update-download') as HTMLAnchorElement;
const updateDismiss = document.getElementById('update-dismiss') as HTMLButtonElement;

type PopupState = {
  userName?: string;
  roomId?: string | null;
  isHost?: boolean;
};

function updateUi(state: PopupState) {
  if (state.userName) nameInput.value = state.userName;
  if (state.roomId) roomInput.value = state.roomId;

  if (state.roomId) {
    const role = state.isHost ? 'Хост' : 'Гость';
    statusEl.textContent = `${role} · Комната ${state.roomId}`;
    statusEl.className = 'status connected';
    roleEl.textContent = state.isHost
      ? 'Вы хост — управление синхронизируется с друзьями'
      : 'Вы в комнате — следуете за хостом';
    connectBtn.classList.add('hidden');
    disconnectBtn.classList.remove('hidden');
    return;
  }

  statusEl.textContent = 'Не подключено';
  statusEl.className = 'status disconnected';
  roleEl.textContent = 'Создайте комнату на сайте — расширение подключится само';
  connectBtn.classList.remove('hidden');
  disconnectBtn.classList.add('hidden');
}

function showUpdateBanner(info: ExtensionUpdateInfo) {
  if (!info.hasUpdate || !info.latestVersion) {
    updateBanner.hidden = true;
    updateBanner.classList.add('hidden');
    return;
  }

  updateText.textContent = `Доступна версия ${info.latestVersion} (у вас ${info.currentVersion}). Скачайте архив и перезагрузите расширение в chrome://extensions.`;
  updateDownload.href = info.downloadUrl || info.releaseUrl || '#';
  if (!info.downloadUrl && !info.releaseUrl) {
    updateDownload.classList.add('hidden');
  } else {
    updateDownload.classList.remove('hidden');
  }
  updateBanner.hidden = false;
  updateBanner.classList.remove('hidden');
}

async function refreshState() {
  const state = await browser.runtime.sendMessage({ type: 'sync-from-web' });
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
  if (roomId.length < 4) return;

  await browser.runtime.sendMessage({ type: 'join-room', roomId, userName });
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
