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

export interface ClientMessage {
  action: 'create-room' | 'join-room' | 'leave-room' | 'sync' | 'set-video-url';
  roomId?: string;
  userName?: string;
  sync?: SyncEvent;
  videoUrl?: string;
}

export interface ServerMessage {
  type: 'room-created' | 'room-joined' | 'room-state' | 'sync' | 'error' | 'members-updated';
  room?: RoomState;
  sync?: SyncEvent;
  error?: string;
  userId?: string;
}
