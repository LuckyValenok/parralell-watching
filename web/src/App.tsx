import { useEffect, useRef, useState } from 'react';
import { Chat } from './Chat';
import { useRoom } from './useRoom';
import { isSupportedWatchUrl } from './mirrors';
import type { ConnectionStatus } from './types';

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function connectionLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'connected':
      return 'Онлайн';
    case 'reconnecting':
      return 'Переподключение...';
    case 'connecting':
      return 'Подключение...';
    default:
      return 'Нет связи';
  }
}

function openedVideoStorageKey(roomId: string): string {
  return `pw-opened-video:${roomId}`;
}

export default function App() {
  const {
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
  } = useRoom();
  const [userName, setUserName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [videoUrl, setVideoUrlLocal] = useState('');
  const [copied, setCopied] = useState(false);
  const pendingWatchTab = useRef<Window | null>(null);
  const openedVideoUrl = useRef<string | null>(null);
  const autoJoinRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room');
    const name = params.get('name');
    if (code) setJoinCode(code.toUpperCase());
    if (name) setUserName(decodeURIComponent(name));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room');
    const name = params.get('name');
    if (!code || !name || room || autoJoinRef.current) return;
    if (connectionStatus !== 'connected') return;

    autoJoinRef.current = true;
    joinRoom(code.toUpperCase(), name, joinPassword || undefined);
  }, [connectionStatus, room, joinRoom, joinPassword]);

  const isHost = room?.members.find((m) => m.id === userId)?.isHost ?? false;
  const onlineCount = room?.members.filter((m) => m.connected).length ?? 0;
  const bufferingMembers = room?.members.filter((m) => m.connected && m.buffering) ?? [];

  useEffect(() => {
    if (!room || !userId) {
      openedVideoUrl.current = null;
      return;
    }
    if (isHost) return;

    if (!room.videoUrl || !isSupportedWatchUrl(room.videoUrl)) {
      if (pendingWatchTab.current && !pendingWatchTab.current.closed) {
        const blank = pendingWatchTab.current.location.href === 'about:blank';
        if (blank) pendingWatchTab.current.close();
      }
      pendingWatchTab.current = null;
      sessionStorage.removeItem(openedVideoStorageKey(room.id));
      return;
    }

    const openedKey = openedVideoStorageKey(room.id);
    if (sessionStorage.getItem(openedKey) === room.videoUrl) return;

    sessionStorage.setItem(openedKey, room.videoUrl);
    openedVideoUrl.current = room.videoUrl;

    if (pendingWatchTab.current && !pendingWatchTab.current.closed) {
      pendingWatchTab.current.location.href = room.videoUrl;
      pendingWatchTab.current = null;
      return;
    }

    window.open(room.videoUrl, '_blank', 'noopener,noreferrer');
  }, [room, userId, isHost]);

  useEffect(() => {
    if (!error) return;
    pendingWatchTab.current?.close();
    pendingWatchTab.current = null;
  }, [error]);

  const handleJoin = () => {
    pendingWatchTab.current = window.open('about:blank', '_blank');
    joinRoom(joinCode, userName || 'Гость', joinPassword || undefined);
  };

  const copyCode = async () => {
    if (!room) return;
    await navigator.clipboard.writeText(room.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyLink = async () => {
    if (!room) return;
    const name = room.members.find((m) => m.id === userId)?.name ?? userName;
    const params = new URLSearchParams({ room: room.id });
    if (name) params.set('name', name);
    const url = `${window.location.origin}${import.meta.env.BASE_URL}?${params.toString()}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!room) {
    return (
      <div className="app">
        {connectionStatus === 'reconnecting' && (
          <div className="reconnect-banner">Переподключение к серверу...</div>
        )}

        <header className="hero">
          <div className="logo">▶</div>
          <h1>Parallel Watching</h1>
          <p className="subtitle">Смотрите сериалы и фильмы на HDRezka вместе с друзьями</p>
        </header>

        <div className="card">
          <label htmlFor="name">Ваше имя</label>
          <input
            id="name"
            type="text"
            placeholder="Как вас называть?"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            maxLength={24}
          />

          <label htmlFor="create-password">Пароль комнаты (необязательно)</label>
          <input
            id="create-password"
            type="password"
            placeholder="Приватная комната"
            value={createPassword}
            onChange={(e) => setCreatePassword(e.target.value)}
            maxLength={32}
            autoComplete="new-password"
          />

          <button
            className="btn primary"
            onClick={() => createRoom(userName || 'Гость', createPassword || undefined)}
            disabled={connectionStatus !== 'connected'}
          >
            Создать комнату
          </button>

          <div className="divider">
            <span>или</span>
          </div>

          <label htmlFor="code">Код комнаты</label>
          <input
            id="code"
            type="text"
            placeholder="ABC123"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            maxLength={6}
          />

          <label htmlFor="join-password">Пароль</label>
          <input
            id="join-password"
            type="password"
            placeholder={errorCode === 'password-required' ? 'Нужен пароль' : 'Если комната приватная'}
            value={joinPassword}
            onChange={(e) => setJoinPassword(e.target.value)}
            maxLength={32}
            autoComplete="current-password"
          />

          <button
            className="btn secondary"
            onClick={handleJoin}
            disabled={connectionStatus !== 'connected' || joinCode.length < 4}
          >
            Присоединиться
          </button>

          {error && <p className="error">{error}</p>}
          {connectionStatus === 'connecting' && <p className="hint">Подключение к серверу...</p>}
        </div>

        <section className="steps">
          <h2>Как это работает</h2>
          <ol>
            <li>Создайте комнату — расширение подключится автоматически</li>
            <li>Откройте фильм на HDRezka (rezka.fi и другие зеркала)</li>
            <li>Отправьте друзьям ссылку с кодом комнаты</li>
            <li>Play, pause и серии синхронизируются у всех</li>
          </ol>
        </section>
      </div>
    );
  }

  return (
    <div className="app">
      {connectionStatus === 'reconnecting' && (
        <div className="reconnect-banner">Связь потеряна — переподключение...</div>
      )}

      <header className="room-header">
        <div>
          <h1>
            Комната {room.id}
            {room.hasPassword && <span className="room-lock" title="Приватная комната">🔒</span>}
          </h1>
          <span className={`status ${connectionStatus === 'connected' ? 'online' : 'offline'}`}>
            {connectionLabel(connectionStatus)}
          </span>
        </div>
        <button className="btn ghost" onClick={leaveRoom}>
          Выйти
        </button>
      </header>

      {room.waitingBuffer && (
        <div className="buffer-banner">
          ⏳ Ждём загрузки
          {bufferingMembers.length > 0
            ? `: ${bufferingMembers.map((m) => m.name).join(', ')}`
            : ' участников'}
        </div>
      )}

      <div className="room-grid">
        <div className="card">
          <h2>Пригласить друзей</h2>
          <div className="code-display">{room.id}</div>
          <div className="btn-row">
            <button className="btn secondary" onClick={copyCode}>
              {copied ? 'Скопировано!' : 'Копировать код'}
            </button>
            <button className="btn secondary" onClick={copyLink}>
              Ссылка для входа
            </button>
          </div>
          <p className="hint">Ссылка откроет сайт и подставит имя — останется нажать «Присоединиться»</p>
        </div>

        <div className="card">
          <h2>
            Участники ({onlineCount} онлайн / {room.members.length})
          </h2>
          <ul className="members">
            {room.members.map((m) => (
              <li key={m.id} className={m.id === userId ? 'me' : ''}>
                <div className="member-main">
                  <span className="member-name">
                    {m.name}
                    {m.isHost && <span className="badge">Хост</span>}
                    {m.id === userId && <span className="badge you">Вы</span>}
                  </span>
                  <span className="member-tags">
                    {m.onPlayer && <span className="member-tag player">на плеере</span>}
                    {m.buffering && <span className="member-tag buffering">буфер</span>}
                  </span>
                </div>
                <div className="member-actions">
                  {isHost && m.id !== userId && m.connected && (
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => transferHost(m.id)}
                      title="Передать роль хоста"
                    >
                      → хост
                    </button>
                  )}
                  <span className={`dot ${m.connected ? 'online' : 'offline'}`} title={m.connected ? 'Онлайн' : 'Оффлайн'} />
                </div>
              </li>
            ))}
          </ul>
        </div>

        {isHost && (
          <div className="card full-width">
            <h2>Ссылка на видео</h2>
            <p className="hint">Вставьте ссылку на фильм/серию с HDRezka</p>
            <div className="input-row">
              <input
                type="url"
                placeholder="https://rezka.fi/films/..."
                value={videoUrl}
                onChange={(e) => setVideoUrlLocal(e.target.value)}
              />
              <button
                className="btn primary"
                onClick={() => setVideoUrl(videoUrl)}
                disabled={!isSupportedWatchUrl(videoUrl)}
              >
                Установить
              </button>
            </div>
            {room.videoUrl && (
              <p className="current-url">
                Текущее: <a href={room.videoUrl} target="_blank" rel="noreferrer">{room.videoUrl}</a>
              </p>
            )}
          </div>
        )}

        {!isHost && room.videoUrl && (
          <div className="card full-width">
            <h2>Видео</h2>
            <p>Ссылка открывается автоматически. Если вкладка не появилась — откройте вручную:</p>
            <a className="video-link" href={room.videoUrl} target="_blank" rel="noreferrer">
              {room.videoUrl}
            </a>
          </div>
        )}

        <div className="card full-width">
          <h2>Статус воспроизведения</h2>
          <div className="playback-status">
            <span className={`play-indicator ${room.isPlaying ? 'playing' : 'paused'}`}>
              {room.waitingBuffer ? '⏳ Ожидание' : room.isPlaying ? '▶ Играет' : '⏸ Пауза'}
            </span>
            <span className="time">{formatTime(room.currentTime)}</span>
          </div>
          <p className="hint">
            {isHost
              ? 'Откройте HDRezka — расширение знает, что вы хост. При буферизации у гостей все ставятся на паузу.'
              : 'Видео откроется автоматически — расширение подключится к комнате само.'}
          </p>
        </div>

        <Chat
          messages={chatMessages}
          userId={userId}
          connected={connectionStatus === 'connected'}
          onSend={sendChat}
          onReaction={sendReaction}
        />
      </div>
    </div>
  );
}
