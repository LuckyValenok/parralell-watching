import { v4 as uuidv4 } from 'uuid';
import type { ChatMessage, RoomMember, RoomState } from './types.js';

const ALLOWED_REACTIONS = new Set(['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉']);

const MAX_CHAT_HISTORY = 100;

interface Room {
  state: RoomState;
  sockets: Map<string, string>;
  chatHistory: ChatMessage[];
}

const rooms = new Map<string, Room>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

export function createRoom(userName: string): { room: RoomState; userId: string } {
  const roomId = generateRoomCode();
  const userId = uuidv4();
  const member: RoomMember = {
    id: userId,
    name: userName,
    isHost: true,
    connected: true,
  };

  const state: RoomState = {
    id: roomId,
    videoUrl: null,
    isPlaying: false,
    currentTime: 0,
    updatedAt: Date.now(),
    members: [member],
  };

  rooms.set(roomId, { state, sockets: new Map(), chatHistory: [] });
  return { room: state, userId };
}

export function joinRoom(
  roomId: string,
  userName: string
): { room: RoomState; userId: string } | null {
  const room = rooms.get(roomId.toUpperCase());
  if (!room) return null;

  const userId = uuidv4();
  const member: RoomMember = {
    id: userId,
    name: userName,
    isHost: false,
    connected: true,
  };

  room.state.members.push(member);
  return { room: room.state, userId };
}

export function bindSocket(roomId: string, userId: string, socketId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  room.sockets.set(userId, socketId);
}

export function leaveRoom(roomId: string, userId: string): RoomState | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  room.sockets.delete(userId);
  room.state.members = room.state.members.filter((m) => m.id !== userId);

  if (room.state.members.length === 0) {
    rooms.delete(roomId);
    return null;
  }

  const hasHost = room.state.members.some((m) => m.isHost);
  if (!hasHost) {
    room.state.members[0].isHost = true;
  }

  return room.state;
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function updateRoomState(
  roomId: string,
  update: Partial<Pick<RoomState, 'videoUrl' | 'isPlaying' | 'currentTime'>>
): RoomState | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  if (update.videoUrl !== undefined) room.state.videoUrl = update.videoUrl;
  if (update.isPlaying !== undefined) room.state.isPlaying = update.isPlaying;
  if (update.currentTime !== undefined) room.state.currentTime = update.currentTime;
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
  if (member) member.connected = connected;

  return room.state;
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
