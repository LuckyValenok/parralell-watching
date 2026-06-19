import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CHAT_QUICK_EMOJIS,
  CHAT_REACTION_EMOJIS,
  computeReactionPickerCoords,
  REACTION_PICKER_HIDE_MS,
  type ReactionPickerCoords,
} from '../../shared/chat.js';
import type { ChatMessage } from './types';

interface ChatProps {
  messages: ChatMessage[];
  userId: string | null;
  connected: boolean;
  onSend: (text: string) => void;
  onReaction: (messageId: string, emoji: string) => void;
}

function formatChatTime(sentAt: number): string {
  return new Date(sentAt).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MessageBubble({
  msg,
  userId,
  onReaction,
  onPickerShow,
  onPickerHide,
}: {
  msg: ChatMessage;
  userId: string | null;
  onReaction: (messageId: string, emoji: string) => void;
  onPickerShow: (messageId: string, anchor: HTMLElement) => void;
  onPickerHide: () => void;
}) {
  const mine = msg.userId === userId;
  const hasReactions = msg.reactions && Object.keys(msg.reactions).length > 0;
  const wrapRef = useRef<HTMLDivElement>(null);

  return (
    <div className={`chat-message${mine ? ' mine' : ''}`}>
      <div className="chat-message-inner">
        <div
          ref={wrapRef}
          className="chat-bubble-wrap"
          onMouseEnter={() => {
            if (wrapRef.current) onPickerShow(msg.id, wrapRef.current);
          }}
          onMouseLeave={onPickerHide}
        >
          <div className="chat-bubble">
            {!mine && <span className="chat-author">{msg.userName}</span>}
            <div className="chat-body">
              <span className="chat-text">{msg.text}</span>
              <span className="chat-time">{formatChatTime(msg.sentAt)}</span>
            </div>
          </div>

          {hasReactions && (
            <div className="chat-reactions">
              {Object.entries(msg.reactions!).map(([emoji, users]) => (
                <button
                  key={emoji}
                  type="button"
                  className={`chat-reaction-chip${users.includes(userId ?? '') ? ' active' : ''}`}
                  onClick={() => onReaction(msg.id, emoji)}
                >
                  <span className="chat-reaction-emoji">{emoji}</span>
                  <span className="chat-reaction-count">{users.length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FloatingReactionPicker({
  messageId,
  anchor,
  boundsEl,
  onReaction,
  onHide,
  onCancelHide,
}: {
  messageId: string;
  anchor: HTMLElement;
  boundsEl: HTMLElement;
  onReaction: (messageId: string, emoji: string) => void;
  onHide: () => void;
  onCancelHide: () => void;
}) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<ReactionPickerCoords>({ top: -9999, left: -9999 });
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const update = () => {
      const picker = pickerRef.current;
      if (!picker) return;
      const anchorRect = anchor.getBoundingClientRect();
      const bounds = boundsEl.getBoundingClientRect();
      setCoords(
        computeReactionPickerCoords(
          anchorRect,
          bounds,
          picker.offsetWidth,
          picker.offsetHeight
        )
      );
      setVisible(true);
    };
    update();
    requestAnimationFrame(update);
  }, [anchor, boundsEl, messageId]);

  return createPortal(
    <div
      ref={pickerRef}
      className={`chat-reaction-picker-float${visible ? ' visible' : ''}`}
      style={{ top: coords.top, left: coords.left }}
      role="toolbar"
      aria-label="Быстрые реакции"
      onMouseEnter={onCancelHide}
      onMouseLeave={onHide}
    >
      {CHAT_REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="chat-reaction-picker-btn"
          onClick={() => onReaction(messageId, emoji)}
        >
          {emoji}
        </button>
      ))}
    </div>,
    document.body
  );
}

export function Chat({ messages, userId, connected, onSend, onReaction }: ChatProps) {
  const [draft, setDraft] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeReaction, setActiveReaction] = useState<{
    id: string;
    anchor: HTMLElement;
  } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const reactionHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (reactionHideTimer.current) clearTimeout(reactionHideTimer.current);
    },
    []
  );

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const hide = () => setActiveReaction(null);
    list.addEventListener('scroll', hide, { passive: true });
    return () => list.removeEventListener('scroll', hide);
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    const close = (e: MouseEvent) => {
      if (!composerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [pickerOpen]);

  const cancelReactionHide = () => {
    if (reactionHideTimer.current) clearTimeout(reactionHideTimer.current);
  };

  const scheduleReactionHide = () => {
    cancelReactionHide();
    reactionHideTimer.current = setTimeout(
      () => setActiveReaction(null),
      REACTION_PICKER_HIDE_MS
    );
  };

  const showReactionPicker = (messageId: string, anchor: HTMLElement) => {
    cancelReactionHide();
    setActiveReaction({ id: messageId, anchor });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    onSend(text);
    setDraft('');
    setPickerOpen(false);
  };

  const insertEmoji = (emoji: string) => {
    setDraft((prev) => prev + emoji);
    setPickerOpen(false);
  };

  return (
    <div className="card full-width chat">
      <h2>Чат</h2>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 ? (
          <p className="chat-empty">Пока тихо — напишите первым</p>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              userId={userId}
              onReaction={onReaction}
              onPickerShow={showReactionPicker}
              onPickerHide={scheduleReactionHide}
            />
          ))
        )}
      </div>

      {activeReaction && listRef.current && (
        <FloatingReactionPicker
          messageId={activeReaction.id}
          anchor={activeReaction.anchor}
          boundsEl={listRef.current}
          onReaction={onReaction}
          onHide={scheduleReactionHide}
          onCancelHide={cancelReactionHide}
        />
      )}

      <div className="chat-composer" ref={composerRef}>
        {pickerOpen && (
          <div className="chat-emoji-panel">
            {CHAT_QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="chat-emoji-panel-btn"
                onClick={() => insertEmoji(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        <form className="chat-composer-box" onSubmit={handleSubmit}>
          <button
            type="button"
            className={`chat-emoji-toggle${pickerOpen ? ' active' : ''}`}
            onClick={() => setPickerOpen((v) => !v)}
            disabled={!connected}
            title="Эмодзи"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="9" cy="10" r="1.1" fill="currentColor" />
              <circle cx="15" cy="10" r="1.1" fill="currentColor" />
            </svg>
          </button>
          <input
            type="text"
            className="chat-input"
            placeholder={connected ? 'Сообщение' : 'Нет связи...'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
            disabled={!connected}
          />
          <button
            className="chat-send-btn"
            type="submit"
            disabled={!connected || !draft.trim()}
            title="Отправить"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M3.4 20.6 21 12 3.4 3.4l2.8 7.2L17 12l-10.8 1.4-2.8 7.2z" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
