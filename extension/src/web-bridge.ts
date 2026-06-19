import { SESSION_STORAGE_KEY, parseSession } from '../../shared/session.js';

function isExtensionAlive(): boolean {
  try {
    return Boolean(browser.runtime?.id);
  } catch {
    return false;
  }
}

function sendToExtension(message: Record<string, unknown>): void {
  if (!isExtensionAlive()) return;
  try {
    browser.runtime.sendMessage(message).catch(() => {});
  } catch {
    // Extension was reloaded — refresh this page to reconnect.
  }
}

function publishSession(): void {
  if (!isExtensionAlive()) return;

  const session = parseSession(localStorage.getItem(SESSION_STORAGE_KEY));
  if (!session) {
    sendToExtension({ type: 'web-session-cleared' });
    return;
  }
  sendToExtension({ type: 'web-session', session });
}

publishSession();

window.addEventListener('storage', (event) => {
  if (event.key === SESSION_STORAGE_KEY) publishSession();
});

window.addEventListener('pw-session-updated', publishSession);
