export const SESSION_STORAGE_KEY = 'pw-session';

export interface WatchSession {
  roomId: string;
  userId: string;
  userName: string;
  isHost: boolean;
  serverUrl: string;
  providerId: string | null;
  updatedAt: number;
}

export const LOCAL_WEB_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
] as const;

export function isWebAppUrl(url: string, extraOrigins: string[] = []): boolean {
  try {
    const origin = new URL(url).origin;
    return [...LOCAL_WEB_ORIGINS, ...extraOrigins].includes(origin);
  } catch {
    return false;
  }
}

export function parseSession(raw: string | null): WatchSession | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as WatchSession;
    if (!data.roomId || !data.userId) return null;
    return data;
  } catch {
    return null;
  }
}
