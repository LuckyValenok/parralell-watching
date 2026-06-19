import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { ChatMessage, RoomMember, RoomState } from './types.js';

const ALLOWED_REACTIONS = new Set(['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉']);

const MAX_CHAT_HISTORY = 100;

interface Room {
  state: RoomState;
  sockets: Map<string, string>;
  chatHistory: ChatMessage[];
  passwordHash: string | null;
  resumeAfterBuffer: boolean;
}

const rooms = new Map<string, Room>();

function hashPassword(password: string): string {
  return createHash('sha256').update(password.trim()).digest('hex');
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function baseState(roomId: string, members: RoomMember[]): RoomState {
  return {
    id: roomId,
    videoUrl: null,
    isPlaying: false,
    currentTime: 0,
    updatedAt: Date.now(),
    members,
    hasPassword: false,
    waitingBuffer: false,
  };
}

export function createRoom(
  userName: string,
  password?: string
): { room: RoomState; userId: string } {
  const roomId = generateRoomCode();
  const userId = uuidv4();
  const trimmedPassword = password?.trim();
  const member: RoomMember = {
    id: userId,
    name: userName,
    isHost: true,
    connected: true,
    buffering: false,
    onPlayer: false,
  };

  const state = baseState(roomId, [member]);
  state.hasPassword = Boolean(trimmedPassword);

  rooms.set(roomId, {
    state,
    sockets: new Map(),
    chatHistory: [],
    passwordHash: trimmedPassword ? hashPassword(trimmedPassword) : null,
    resumeAfterBuffer: false,
  });
  return { room: state, userId };
}

export function verifyRoomPassword(roomId: string, password?: string): boolean {
  const room = rooms.get(roomId.toUpperCase());
  if (!room) return false;
  if (!room.passwordHash) return true;
  if (!password?.trim()) return false;
  return room.passwordHash === hashPassword(password);
}

export function joinRoom(
  roomId: string,
  userName: string,
  password?: string
): { room: RoomState; userId: string } | 'not-found' | 'wrong-password' | 'password-required' {
  const room = rooms.get(roomId.toUpperCase());
  if (!room) return 'not-found';

  if (room.passwordHash) {
    if (!password?.trim()) return 'password-required';
    if (room.passwordHash !== hashPassword(password)) return 'wrong-password';
  }

  const userId = uuidv4();
  const member: RoomMember = {
    id: userId,
    name: userName,
    isHost: false,
    connected: true,
    buffering: false,
    onPlayer: false,
  };

  room.state.members.push(member);
  return { room: room.state, userId };
}

export function bindSocket(roomId: string, userId: string, socketId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  room.sockets.set(userId, socketId);
}

export function electHost(roomId: string): RoomState | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  const hasHost = room.state.members.some((m) => m.isHost && m.connected);
  if (hasHost) return room.state;

  const next =
    room.state.members.find((m) => m.connected && m.onPlayer) ??
    room.state.members.find((m) => m.connected);

  if (!next) return room.state;

  for (const m of room.state.members) {
    m.isHost = m.id === next.id;
  }
  room.state.updatedAt = Date.now();
  return room.state;
}

export function transferHost(
  roomId: string,
  fromUserId: string,
  toUserId: string
): RoomState | 'not-host' | 'member-not-found' | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  const from = room.state.members.find((m) => m.id === fromUserId);
  if (!from?.isHost) return 'not-host';

  const to = room.state.members.find((m) => m.id === toUserId && m.connected);
  if (!to) return 'member-not-found';

  for (const m of room.state.members) {
    m.isHost = m.id === toUserId;
  }
  room.state.updatedAt = Date.now();
  return room.state;
}

export function leaveRoom(roomId: string, userId: string): RoomState | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  const wasHost = room.state.members.find((m) => m.id === userId)?.isHost;
  room.sockets.delete(userId);
  room.state.members = room.state.members.filter((m) => m.id !== userId);

  if (room.state.members.length === 0) {
    rooms.delete(roomId);
    return null;
  }

  if (wasHost) {
    electHost(roomId);
  }

  checkBufferResume(roomId);
  return room.state;
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function updateRoomState(
  roomId: string,
  update: Partial<Pick<RoomState, 'videoUrl' | 'isPlaying' | 'currentTime' | 'waitingBuffer'>>
): RoomState | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  if (update.videoUrl !== undefined) room.state.videoUrl = update.videoUrl;
  if (update.isPlaying !== undefined) room.state.isPlaying = update.isPlaying;
  if (update.currentTime !== undefined) room.state.currentTime = update.currentTime;
  if (update.waitingBuffer !== undefined) room.state.waitingBuffer = update.waitingBuffer;
  room.state.updatedAt = Date.now();

  return room.state;
}

export function setMemberConnected(
  roomId: string,
  userId: string,
  connected: boolean
): RoomState | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  const member = room.state.members.find((m) => m.id === userId);
  if (member) {
    member.connected = connected;
    if (!connected) {
      member.buffering = false;
      member.onPlayer = false;
    }
  }

  if (!connected) {
    const wasHost = member?.isHost;
    if (wasHost) electHost(roomId);
    checkBufferResume(roomId);
  }

  return room.state;
}

export function setMemberOnPlayer(
  roomId: string,
  userId: string,
  onPlayer: boolean
): RoomState | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  const member = room.state.members.find((m) => m.id === userId);
  if (member) member.onPlayer = onPlayer;

  return room.state;
}

export function setMemberBuffering(
  roomId: string,
  userId: string,
  buffering: boolean
): { state: RoomState; pausedAll: boolean; resumedAll: boolean } | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  const member = room.state.members.find((m) => m.id === userId);
  if (!member) return null;

  member.buffering = buffering;

  let pausedAll = false;
  let resumedAll = false;

  if (buffering) {
    if (room.state.isPlaying && !room.state.waitingBuffer) {
      room.state.waitingBuffer = true;
      room.resumeAfterBuffer = true;
      updateRoomState(roomId, { isPlaying: false, waitingBuffer: true });
      pausedAll = true;
    }
  } else {
    const anyBuffering = room.state.members.some((m) => m.connected && m.buffering);
    if (room.state.waitingBuffer && !anyBuffering) {
      resumedAll = tryResumeAfterBuffer(roomId);
    }
  }

  return { state: room.state, pausedAll, resumedAll };
}

function tryResumeAfterBuffer(roomId: string): boolean {
  const room = rooms.get(roomId);
  if (!room || !room.state.waitingBuffer) return false;

  const anyBuffering = room.state.members.some((m) => m.connected && m.buffering);
  if (anyBuffering) return false;

  const shouldResume = room.resumeAfterBuffer;
  room.state.waitingBuffer = false;
  room.resumeAfterBuffer = false;

  if (shouldResume) {
    updateRoomState(roomId, { isPlaying: true });
    return true;
  }
  return false;
}

export function checkBufferResume(roomId: string): boolean {
  return tryResumeAfterBuffer(roomId);
}

export function getResumeAfterBuffer(roomId: string): boolean {
  const room = rooms.get(roomId);
  return room?.resumeAfterBuffer ?? false;
}

export function clearResumeAfterBuffer(roomId: string): void {
  const room = rooms.get(roomId);
  if (room) room.resumeAfterBuffer = false;
}

export function getChatHistory(roomId: string): ChatMessage[] {
  const room = rooms.get(roomId);
  if (!room) return [];
  return [...room.chatHistory];
}

export function addChatMessage(
  roomId: string,
  userId: string,
  userName: string,
  text: string
): ChatMessage | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  const message: ChatMessage = {
    id: uuidv4(),
    roomId,
    userId,
    userName,
    text,
    sentAt: Date.now(),
  };

  room.chatHistory.push(message);
  if (room.chatHistory.length > MAX_CHAT_HISTORY) {
    room.chatHistory.splice(0, room.chatHistory.length - MAX_CHAT_HISTORY);
  }

  return message;
}

export function toggleChatReaction(
  roomId: string,
  messageId: string,
  userId: string,
  emoji: string
): { messageId: string; reactions: Record<string, string[]> } | null {
  if (!ALLOWED_REACTIONS.has(emoji)) return null;

  const room = rooms.get(roomId);
  if (!room) return null;

  const message = room.chatHistory.find((m) => m.id === messageId);
  if (!message) return null;

  const reactions: Record<string, string[]> = { ...(message.reactions ?? {}) };
  const users = [...(reactions[emoji] ?? [])];
  const idx = users.indexOf(userId);

  if (idx >= 0) {
    users.splice(idx, 1);
    if (users.length === 0) {
      delete reactions[emoji];
    } else {
      reactions[emoji] = users;
    }
  } else {
    reactions[emoji] = [...users, userId];
  }

  message.reactions = Object.keys(reactions).length > 0 ? reactions : undefined;

  return {
    messageId,
    reactions: message.reactions ?? {},
  };
}
