import { io, type Socket } from 'socket.io-client';

type MessageHandler = (msg: Record<string, unknown>) => void;
type ConnectHandler = (status: 'connected' | 'disconnected' | 'reconnecting') => void;

let socket: Socket | null = null;
let onMessage: MessageHandler | null = null;
let onConnect: ConnectHandler | null = null;
const pendingMessages: Record<string, unknown>[] = [];

export function isSocketConnected(): boolean {
  return Boolean(socket?.connected);
}

export function setSocketConnectHandler(handler: ConnectHandler): void {
  onConnect = handler;
}

export function setSocketMessageHandler(handler: MessageHandler): void {
  onMessage = handler;
}

export function connectRoomSocket(
  serverUrl: string,
  joinPayload: Record<string, unknown>
): void {
  disconnectRoomSocket();

  socket = io(serverUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1500,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    onConnect?.('connected');
    socket!.emit('message', joinPayload);
    flushPendingMessages();
  });

  socket.on('disconnect', () => {
    onConnect?.('reconnecting');
  });

  socket.io.on('reconnect_attempt', () => {
    onConnect?.('reconnecting');
  });

  socket.io.on('reconnect_failed', () => {
    onConnect?.('disconnected');
  });

  socket.on('message', (msg: Record<string, unknown>) => {
    onMessage?.(msg);
  });
}

export function disconnectRoomSocket(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}

export function sendRoomMessage(data: Record<string, unknown>): boolean {
  if (!socket?.connected) {
    pendingMessages.push(data);
    return false;
  }
  socket.emit('message', data);
  return true;
}

export function flushPendingMessages(): void {
  if (!socket?.connected) return;
  while (pendingMessages.length > 0) {
    socket.emit('message', pendingMessages.shift()!);
  }
}

export function queueRoomMessage(data: Record<string, unknown>): void {
  pendingMessages.push(data);
}

export function clearPendingMessages(): void {
  pendingMessages.length = 0;
}
