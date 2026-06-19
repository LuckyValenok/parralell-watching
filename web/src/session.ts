import { SESSION_STORAGE_KEY, type WatchSession } from '../../shared/session.js';

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.PROD ? window.location.origin : 'http://localhost:3001');

export function saveWatchSession(
  roomId: string,
  userId: string,
  userName: string,
  isHost: boolean,
  providerId: string | null = null
): void {
  const session: WatchSession = {
    roomId,
    userId,
    userName,
    isHost,
    serverUrl: SERVER_URL,
    providerId,
    updatedAt: Date.now(),
  };
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event('pw-session-updated'));
}

export function clearWatchSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
  window.dispatchEvent(new Event('pw-session-updated'));
}

export function loadWatchSession(): WatchSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WatchSession;
  } catch {
    return null;
  }
}
