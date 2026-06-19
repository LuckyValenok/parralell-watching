import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type { ClientMessage, SyncEvent } from './types.js';
import {
  addChatMessage,
  bindSocket,
  checkBufferResume,
  clearResumeAfterBuffer,
  createRoom,
  electHost,
  getChatHistory,
  getRoom,
  joinRoom,
  leaveRoom,
  setMemberBuffering,
  setMemberConnected,
  setMemberOnPlayer,
  toggleChatReaction,
  transferHost,
  updateRoomState,
  verifyRoomPassword,
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
        const { room, userId } = createRoom(userName, raw.password);
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
          if (existing.passwordHash && !verifyRoomPassword(roomId, raw.password)) {
            if (!raw.password?.trim()) {
              socket.emit('message', {
                type: 'error',
                error: 'Для этой комнаты нужен пароль',
                errorCode: 'password-required',
              });
              return;
            }
            socket.emit('message', {
              type: 'error',
              error: 'Неверный пароль',
              errorCode: 'wrong-password',
            });
            return;
          }

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
          const joined = joinRoom(roomId, userName, raw.password);
          if (joined === 'not-found') {
            socket.emit('message', { type: 'error', error: 'Комната не найдена' });
            return;
          }
          if (joined === 'password-required') {
            socket.emit('message', {
              type: 'error',
              error: 'Для этой комнаты нужен пароль',
              errorCode: 'password-required',
            });
            return;
          }
          if (joined === 'wrong-password') {
            socket.emit('message', {
              type: 'error',
              error: 'Неверный пароль',
              errorCode: 'wrong-password',
            });
            return;
          }
          result = joined;
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

      case 'transfer-host': {
        const session = sessions.get(socket.id);
        if (!session || !raw.targetUserId) return;

        const result = transferHost(session.roomId, session.userId, raw.targetUserId);
        if (result === 'not-host') {
          socket.emit('message', { type: 'error', error: 'Только хост может передать роль', errorCode: 'not-host' });
          return;
        }
        if (result === 'member-not-found') {
          socket.emit('message', { type: 'error', error: 'Участник не найден', errorCode: 'member-not-found' });
          return;
        }
        if (result) {
          io.to(session.roomId).emit('message', { type: 'members-updated', room: result });
        }
        break;
      }

      case 'player-presence': {
        const session = sessions.get(socket.id);
        if (!session || raw.onPlayer === undefined) return;

        const state = setMemberOnPlayer(session.roomId, session.userId, raw.onPlayer);
        if (state) {
          io.to(session.roomId).emit('message', { type: 'members-updated', room: state });
        }
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
    case 'buffer-start': {
      const result = setMemberBuffering(roomId, userId, true);
      if (!result) return;

      if (result.pausedAll) {
        broadcastPause(roomId, userId, result.state.currentTime);
      }
      io.to(roomId).emit('message', { type: 'members-updated', room: result.state });
      return;
    }

    case 'buffer-end': {
      const result = setMemberBuffering(roomId, userId, false);
      if (!result) return;

      if (result.resumedAll) {
        broadcastPlay(roomId, userId, result.state.currentTime);
      }
      io.to(roomId).emit('message', { type: 'members-updated', room: result.state });
      return;
    }

    case 'play': {
      if (room.state.waitingBuffer) return;
      updateRoomState(roomId, { isPlaying: true, currentTime: event.timestamp ?? 0 });
      break;
    }
    case 'pause':
      updateRoomState(roomId, {
        isPlaying: false,
        currentTime: event.timestamp ?? room.state.currentTime,
      });
      clearResumeAfterBuffer(roomId);
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
        waitingBuffer: false,
      });
      clearResumeAfterBuffer(roomId);

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
      const host = room.state.members.find((m) => m.isHost);
      if (host) {
        const hostSocketId = room.sockets.get(host.id);
        if (hostSocketId && host.id !== userId) {
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

function broadcastPause(roomId: string, fromUserId: string, timestamp: number): void {
  const event: SyncEvent = {
    type: 'pause',
    roomId,
    userId: fromUserId,
    timestamp,
    serverTime: Date.now(),
  };
  io.to(roomId).emit('message', { type: 'sync', sync: event });
}

function broadcastPlay(roomId: string, fromUserId: string, timestamp: number): void {
  const event: SyncEvent = {
    type: 'play',
    roomId,
    userId: fromUserId,
    timestamp,
    serverTime: Date.now(),
  };
  io.to(roomId).emit('message', { type: 'sync', sync: event });
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
    electHost(session.roomId);
    const updated = getRoom(session.roomId)?.state ?? state;
    io.to(session.roomId).emit('message', { type: 'members-updated', room: updated });
  }
}

httpServer.listen(PORT, () => {
  console.log(`Sync server running on http://localhost:${PORT}`);
});
