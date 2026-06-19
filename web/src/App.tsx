import { useEffect, useRef, useState } from 'react';
import { Chat } from './Chat';
import { useRoom } from './useRoom';
import { isSupportedWatchUrl } from './mirrors';

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function openedVideoStorageKey(roomId: string): string {
  return `pw-opened-video:${roomId}`;
}

export default function App() {
  const { room, userId, error, connected, chatMessages, createRoom, joinRoom, leaveRoom, setVideoUrl, sendChat, sendReaction } =
    useRoom();
  const [userName, setUserName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [videoUrl, setVideoUrlLocal] = useState('');
  const [copied, setCopied] = useState(false);
  const pendingWatchTab = useRef<Window | null>(null);
  const openedVideoUrl = useRef<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room');
    if (code) setJoinCode(code.toUpperCase());
  }, []);

  const isHost = room?.members.find((m) => m.id === userId)?.isHost ?? false;

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
    joinRoom(joinCode, userName || 'Гость');
  };

  const copyCode = async () => {
    if (!room) return;
    await navigator.clipboard.writeText(room.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyLink = async () => {
    if (!room) return;
    const url = `${window.location.origin}${import.meta.env.BASE_URL}?room=${room.id}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!room) {
    return (
      <div className="app">
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

          <button
            className="btn primary"
            onClick={() => createRoom(userName || 'Гость')}
            disabled={!connected}
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

          <button
            className="btn secondary"
            onClick={handleJoin}
            disabled={!connected || joinCode.length < 4}
          >
            Присоединиться
          </button>

          {error && <p className="error">{error}</p>}
          {!connected && <p className="hint">Подключение к серверу...</p>}
        </div>

        <section className="steps">
          <h2>Как это работает</h2>
          <ol>
            <li>Создайте комнату — расширение подключится автоматически</li>
            <li>Откройте фильм на HDRezka (rezka.fi и другие зеркала)</li>
            <li>Друзья вводят код комнаты на сайте или в расширении</li>
            <li>Play, pause и серии синхронизируются у всех</li>
          </ol>
        </section>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="room-header">
        <div>
          <h1>Комната {room.id}</h1>
          <span className={`status ${connected ? 'online' : 'offline'}`}>
            {connected ? 'Онлайн' : 'Переподключение...'}
          </span>
        </div>
        <button className="btn ghost" onClick={leaveRoom}>
          Выйти
        </button>
      </header>

      <div className="room-grid">
        <div className="card">
          <h2>Пригласить друзей</h2>
          <div className="code-display">{room.id}</div>
          <div className="btn-row">
            <button className="btn secondary" onClick={copyCode}>
              {copied ? 'Скопировано!' : 'Копировать код'}
            </button>
            <button className="btn secondary" onClick={copyLink}>
              Копировать ссылку
            </button>
          </div>
        </div>

        <div className="card">
          <h2>Участники ({room.members.length})</h2>
          <ul className="members">
            {room.members.map((m) => (
              <li key={m.id} className={m.id === userId ? 'me' : ''}>
                <span className="member-name">
                  {m.name}
                  {m.isHost && <span className="badge">Хост</span>}
                  {m.id === userId && <span className="badge you">Вы</span>}
                </span>
                <span className={`dot ${m.connected ? 'online' : 'offline'}`} />
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
            <p>
              Ссылка открывается автоматически. Если вкладка не появилась — откройте вручную:
            </p>
            <a className="video-link" href={room.videoUrl} target="_blank" rel="noreferrer">
              {room.videoUrl}
            </a>
          </div>
        )}

        <div className="card full-width">
          <h2>Статус воспроизведения</h2>
          <div className="playback-status">
            <span className={`play-indicator ${room.isPlaying ? 'playing' : 'paused'}`}>
              {room.isPlaying ? '▶ Играет' : '⏸ Пауза'}
            </span>
            <span className="time">{formatTime(room.currentTime)}</span>
          </div>
          <p className="hint">
            {isHost
              ? 'Откройте HDRezka — расширение уже знает, что вы хост. Управляйте плеером как обычно.'
              : 'Видео откроется автоматически — расширение подключится к комнате само.'}
          </p>
        </div>

        <Chat
          messages={chatMessages}
          userId={userId}
          connected={connected}
          onSend={sendChat}
          onReaction={sendReaction}
        />
      </div>
    </div>
  );
}
