import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { isSupportedWatchUrl } from './mirrors';
import { clearWatchSession, loadWatchSession, saveWatchSession } from './session';
import type { ChatMessage, ClientMessage, ConnectionStatus, RoomState, ServerMessage } from './types';

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.PROD ? window.location.origin : 'http://localhost:3001');

function memberIsHost(room: RoomState, memberId: string): boolean {
  return room.members.find((m) => m.id === memberId)?.isHost ?? false;
}

export function useRoom() {
  const socketRef = useRef<Socket | null>(null);
  const userIdRef = useRef<string | null>(null);
  const restoredRef = useRef(false);
  const leftRef = useRef(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<ServerMessage['errorCode'] | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const persistRoom = useCallback((nextRoom: RoomState, memberId: string) => {
    saveWatchSession(
      nextRoom.id,
      memberId,
      nextRoom.members.find((m) => m.id === memberId)?.name ?? 'Гость',
      memberIsHost(nextRoom, memberId),
      nextRoom.videoUrl && isSupportedWatchUrl(nextRoom.videoUrl) ? 'hdrezka' : null
    );
  }, []);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    const onSessionCleared = () => {
      if (loadWatchSession()) return;
      leftRef.current = true;
      userIdRef.current = null;
      setRoom(null);
      setUserId(null);
      setChatMessages([]);
    };

    window.addEventListener('pw-session-updated', onSessionCleared);
    return () => window.removeEventListener('pw-session-updated', onSessionCleared);
  }, []);

  useEffect(() => {
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1500,
      reconnectionAttempts: Infinity,
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnectionStatus('connected'));
    socket.on('disconnect', () => {
      if (!leftRef.current) setConnectionStatus('reconnecting');
      else setConnectionStatus('disconnected');
    });
    socket.io.on('reconnect_attempt', () => setConnectionStatus('reconnecting'));
    socket.io.on('reconnect', () => setConnectionStatus('connected'));
    socket.io.on('reconnect_failed', () => setConnectionStatus('disconnected'));

    socket.on('message', (msg: ServerMessage) => {
      if (leftRef.current) return;

      switch (msg.type) {
        case 'room-created':
        case 'room-joined':
          leftRef.current = false;
          if (msg.room && msg.userId) {
            setRoom(msg.room);
            setUserId(msg.userId);
            persistRoom(msg.room, msg.userId);
          }
          setError(null);
          setErrorCode(null);
          break;
        case 'chat-history':
          if (msg.chatHistory) {
            setChatMessages(msg.chatHistory);
          }
          break;
        case 'chat':
          if (msg.chat) {
            setChatMessages((prev) => {
              if (prev.some((m) => m.id === msg.chat!.id)) return prev;
              return [...prev, msg.chat!];
            });
          }
          break;
        case 'chat-reaction':
          if (msg.messageId) {
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === msg.messageId
                  ? { ...m, reactions: msg.reactions && Object.keys(msg.reactions).length > 0 ? msg.reactions : undefined }
                  : m
              )
            );
          }
          break;
        case 'room-state':
        case 'members-updated':
          if (msg.room && userIdRef.current) {
            setRoom(msg.room);
            persistRoom(msg.room, userIdRef.current);
          }
          break;
        case 'error':
          setError(msg.error ?? 'Неизвестная ошибка');
          setErrorCode(msg.errorCode ?? null);
          break;
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [persistRoom]);

  useEffect(() => {
    if (connectionStatus !== 'connected' || restoredRef.current || room) return;
    const session = loadWatchSession();
    if (!session) return;

    restoredRef.current = true;
    socketRef.current?.emit('message', {
      action: 'join-room',
      roomId: session.roomId,
      userName: session.userName,
      userId: session.userId,
    } satisfies ClientMessage);
  }, [connectionStatus, room]);

  const send = useCallback((msg: ClientMessage) => {
    socketRef.current?.emit('message', msg);
  }, []);

  const createRoom = useCallback(
    (userName: string, password?: string) => {
      leftRef.current = false;
      setError(null);
      setErrorCode(null);
      send({ action: 'create-room', userName, password: password || undefined });
    },
    [send]
  );

  const joinRoom = useCallback(
    (roomId: string, userName: string, password?: string) => {
      leftRef.current = false;
      setError(null);
      setErrorCode(null);
      send({ action: 'join-room', roomId, userName, password: password || undefined });
    },
    [send]
  );

  const leaveRoom = useCallback(() => {
    leftRef.current = true;
    userIdRef.current = null;
    send({ action: 'leave-room' });
    setRoom(null);
    setUserId(null);
    setChatMessages([]);
    setConnectionStatus('disconnected');
    clearWatchSession();
  }, [send]);

  const setVideoUrl = useCallback(
    (videoUrl: string) => {
      send({ action: 'set-video-url', videoUrl });
    },
    [send]
  );

  const transferHost = useCallback(
    (targetUserId: string) => {
      send({ action: 'transfer-host', targetUserId });
    },
    [send]
  );

  const sendChat = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      send({ action: 'chat', text: trimmed });
    },
    [send]
  );

  const sendReaction = useCallback(
    (messageId: string, emoji: string) => {
      send({ action: 'chat-reaction', messageId, emoji });
    },
    [send]
  );

  return {
    room,
    userId,
    error,
    errorCode,
    connectionStatus,
    chatMessages,
    createRoom,
    joinRoom,
    leaveRoom,
    setVideoUrl,
    transferHost,
    sendChat,
    sendReaction,
  };
}
