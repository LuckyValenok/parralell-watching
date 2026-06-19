import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type { ClientMessage, SyncEvent } from './types.js';
import {
  addChatMessage,
  bindSocket,
  createRoom,
  getChatHistory,
  getRoom,
  joinRoom,
  leaveRoom,
  setMemberConnected,
  toggleChatReaction,
  updateRoomState,
} from './rooms.js';

const MAX_CHAT_LENGTH = 500;

const PORT = Number(process.env.PORT) || 3001;
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGINS,
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

interface SocketSession {
  roomId: string;
  userId: string;
}

const sessions = new Map<string, SocketSession>();

io.on('connection', (socket) => {
  socket.on('message', (raw: ClientMessage) => {
    switch (raw.action) {
      case 'create-room': {
        const userName = raw.userName?.trim() || 'Гость';
        const { room, userId } = createRoom(userName);
        bindSocket(room.id, userId, socket.id);
        sessions.set(socket.id, { roomId: room.id, userId });
        socket.join(room.id);
        socket.emit('message', { type: 'room-created', room, userId });
        break;
      }

      case 'join-room': {
        const roomId = raw.roomId?.toUpperCase();
        if (!roomId) {
          socket.emit('message', { type: 'error', error: 'Укажите код комнаты' });
          return;
        }
        const userName = raw.userName?.trim() || 'Гость';
        const existing = getRoom(roomId);
        let result: { room: import('./types.js').RoomState; userId: string } | null = null;

        if (existing) {
          if (raw.userId) {
            const byId = existing.state.members.find((m) => m.id === raw.userId);
            if (byId) {
              byId.connected = true;
              result = { room: existing.state, userId: byId.id };
            }
          }

          if (!result) {
            const offline = existing.state.members.find(
              (m) => m.name === userName && !m.connected
            );
            if (offline) {
              offline.connected = true;
              result = { room: existing.state, userId: offline.id };
            }
          }
        }

        if (!result) {
          result = joinRoom(roomId, userName);
        }

        if (!result) {
          socket.emit('message', { type: 'error', error: 'Комната не найдена' });
          return;
        }
        bindSocket(roomId, result.userId, socket.id);
        sessions.set(socket.id, { roomId, userId: result.userId });
        socket.join(roomId);
        socket.emit('message', {
          type: 'room-joined',
          room: result.room,
          userId: result.userId,
        });
        const history = getChatHistory(roomId);
        if (history.length > 0) {
          socket.emit('message', { type: 'chat-history', chatHistory: history });
        }
        socket.to(roomId).emit('message', {
          type: 'members-updated',
          room: result.room,
        });
        break;
      }

      case 'set-video-url': {
        const session = sessions.get(socket.id);
        if (!session || !raw.videoUrl) return;
        const room = getRoom(session.roomId);
        if (!room) return;
        const member = room.state.members.find((m) => m.id === session.userId);
        if (!member?.isHost) return;

        const state = updateRoomState(session.roomId, { videoUrl: raw.videoUrl });
        if (state) {
          io.to(session.roomId).emit('message', { type: 'room-state', room: state });
        }
        break;
      }

      case 'sync': {
        const session = sessions.get(socket.id);
        if (!session || !raw.sync) return;
        handleSync(session.roomId, session.userId, raw.sync);
        break;
      }

      case 'leave-room': {
        handleDisconnect(socket.id);
        break;
      }

      case 'chat': {
        const session = sessions.get(socket.id);
        if (!session) return;

        const text = raw.text?.trim();
        if (!text || text.length > MAX_CHAT_LENGTH) return;

        const room = getRoom(session.roomId);
        if (!room) return;

        const member = room.state.members.find((m) => m.id === session.userId);
        if (!member) return;

        const chat = addChatMessage(session.roomId, session.userId, member.name, text);
        if (!chat) return;

        io.to(session.roomId).emit('message', { type: 'chat', chat });
        break;
      }

      case 'chat-reaction': {
        const session = sessions.get(socket.id);
        if (!session || !raw.messageId || !raw.emoji) return;

        const result = toggleChatReaction(
          session.roomId,
          raw.messageId,
          session.userId,
          raw.emoji
        );
        if (!result) return;

        io.to(session.roomId).emit('message', {
          type: 'chat-reaction',
          messageId: result.messageId,
          reactions: result.reactions,
        });
        break;
      }
    }
  });

  socket.on('disconnect', () => {
    handleDisconnect(socket.id);
  });
});

function handleSync(roomId: string, userId: string, event: SyncEvent): void {
  const room = getRoom(roomId);
  if (!room) return;

  switch (event.type) {
    case 'play':
      updateRoomState(roomId, { isPlaying: true, currentTime: event.timestamp ?? 0 });
      break;
    case 'pause':
      updateRoomState(roomId, {
        isPlaying: false,
        currentTime: event.timestamp ?? room.state.currentTime,
      });
      break;
    case 'seek':
      updateRoomState(roomId, { currentTime: event.timestamp ?? 0 });
      break;
    case 'navigate': {
      const member = room.state.members.find((m) => m.id === userId);
      if (!member?.isHost || !event.videoUrl) return;

      const state = updateRoomState(roomId, {
        videoUrl: event.videoUrl,
        currentTime: 0,
        isPlaying: false,
      });

      const enriched: SyncEvent = {
        ...event,
        type: 'navigate',
        roomId,
        userId,
        videoUrl: event.videoUrl,
        serverTime: Date.now(),
      };

      for (const [memberId, socketId] of room.sockets) {
        if (memberId !== userId) {
          io.to(socketId).emit('message', { type: 'sync', sync: enriched });
        }
      }
      if (state) {
        io.to(roomId).emit('message', { type: 'room-state', room: state });
      }
      return;
    }
    case 'sync-request': {
      const requester = room.sockets.get(userId);
      const host = room.state.members.find((m) => m.isHost);
      if (host) {
        const hostSocketId = room.sockets.get(host.id);
        if (hostSocketId && hostSocketId !== requester) {
          io.to(hostSocketId).emit('message', {
            type: 'sync',
            sync: { ...event, type: 'sync-request' },
          });
        } else {
          io.to(roomId).emit('message', {
            type: 'sync',
            sync: {
              type: 'sync-state',
              roomId,
              userId: host?.id ?? userId,
              timestamp: room.state.currentTime,
              serverTime: Date.now(),
            },
          });
        }
      }
      return;
    }
    case 'sync-state':
      if (event.timestamp !== undefined) {
        updateRoomState(roomId, {
          currentTime: event.timestamp,
          isPlaying: room.state.isPlaying,
        });
      }
      break;
  }

  const enriched: SyncEvent = {
    ...event,
    roomId,
    userId,
    serverTime: Date.now(),
  };

  socketBroadcast(roomId, userId, enriched);
}

function socketBroadcast(roomId: string, fromUserId: string, event: SyncEvent): void {
  const room = getRoom(roomId);
  if (!room) return;

  for (const [memberId, socketId] of room.sockets) {
    if (memberId !== fromUserId) {
      io.to(socketId).emit('message', { type: 'sync', sync: event });
    }
  }
}

function handleDisconnect(socketId: string): void {
  const session = sessions.get(socketId);
  if (!session) return;

  const room = getRoom(session.roomId);
  if (room) room.sockets.delete(session.userId);

  const state = setMemberConnected(session.roomId, session.userId, false);
  sessions.delete(socketId);

  if (state) {
    io.to(session.roomId).emit('message', { type: 'members-updated', room: state });
  }
}

httpServer.listen(PORT, () => {
  console.log(`Sync server running on http://localhost:${PORT}`);
});
