export interface RoomMember {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
}

export interface RoomState {
  id: string;
  videoUrl: string | null;
  isPlaying: boolean;
  currentTime: number;
  updatedAt: number;
  members: RoomMember[];
}

export type SyncEventType =
  | 'play'
  | 'pause'
  | 'seek'
  | 'navigate'
  | 'sync-request'
  | 'sync-state'
  | 'video-url'
  | 'member-join'
  | 'member-leave';

export interface SyncEvent {
  type: SyncEventType;
  roomId: string;
  userId: string;
  userName?: string;
  timestamp?: number;
  videoUrl?: string;
  serverTime?: number;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  text: string;
  sentAt: number;
  reactions?: Record<string, string[]>;
}

export interface ClientMessage {
  action: 'create-room' | 'join-room' | 'leave-room' | 'sync' | 'set-video-url' | 'chat' | 'chat-reaction';
  roomId?: string;
  userName?: string;
  userId?: string;
  sync?: SyncEvent;
  videoUrl?: string;
  text?: string;
  messageId?: string;
  emoji?: string;
}

export interface ServerMessage {
  type:
    | 'room-created'
    | 'room-joined'
    | 'room-state'
    | 'sync'
    | 'error'
    | 'members-updated'
    | 'chat'
    | 'chat-history'
    | 'chat-reaction';
  room?: RoomState;
  sync?: SyncEvent;
  error?: string;
  userId?: string;
  chat?: ChatMessage;
  chatHistory?: ChatMessage[];
  messageId?: string;
  reactions?: Record<string, string[]>;
}
