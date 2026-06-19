import {
  CHAT_QUICK_EMOJIS,
  CHAT_REACTION_EMOJIS,
  computeReactionPickerCoords,
  REACTION_PICKER_HIDE_MS,
  type ChatMessage,
} from '../../shared/chat.js';
import { notifyChatMessage, playChatNotificationSound } from '../../shared/chat-notify.js';

interface ChatOverlayOptions {
  getUserId: () => string | null;
  getRoomId: () => string | null;
}

const SMILEY_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="9" cy="10" r="1.1" fill="currentColor"/><circle cx="15" cy="10" r="1.1" fill="currentColor"/></svg>`;

const SEND_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.6 21 12 3.4 3.4l2.8 7.2L17 12l-10.8 1.4-2.8 7.2z"/></svg>`;

export function createChatOverlay(options: ChatOverlayOptions) {
  let root: HTMLDivElement | null = null;
  let panel: HTMLDivElement | null = null;
  let listEl: HTMLDivElement | null = null;
  let badgeEl: HTMLSpanElement | null = null;
  let inputEl: HTMLInputElement | null = null;
  let composerEl: HTMLDivElement | null = null;
  let emojiPanelEl: HTMLDivElement | null = null;
  let emojiToggleBtn: HTMLButtonElement | null = null;
  let reactionPickerEl: HTMLDivElement | null = null;
  let reactionPickerMsgId: string | null = null;
  let reactionHideTimer: ReturnType<typeof setTimeout> | null = null;
  let pickerOpen = false;
  let open = false;
  let unread = 0;
  const messages: ChatMessage[] = [];
  const seenIds = new Set<string>();

  function setPickerOpen(next: boolean) {
    pickerOpen = next;
    if (emojiPanelEl) emojiPanelEl.hidden = !next;
    emojiToggleBtn?.classList.toggle('active', next);
  }

  function getFullscreenElement(): Element | null {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      mozFullScreenElement?: Element | null;
    };
    return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.mozFullScreenElement ?? null;
  }

  function onFullscreenChange() {
    if (!root) return;
    const fs = getFullscreenElement();
    if (fs) {
      fs.appendChild(root);
      root.classList.add('pw-chat-fullscreen');
    } else {
      document.body.appendChild(root);
      root.classList.remove('pw-chat-fullscreen');
    }
  }

  function onDocClick(e: MouseEvent) {
    if (!pickerOpen || !composerEl) return;
    if (!composerEl.contains(e.target as Node)) setPickerOpen(false);
  }

  function ensureDom() {
    if (root) return;

    root = document.createElement('div');
    root.id = 'pw-chat-root';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 'pw-chat-toggle';
    toggle.title = 'Чат комнаты';
    toggle.textContent = '💬';
    toggle.addEventListener('click', () => setOpen(!open));

    badgeEl = document.createElement('span');
    badgeEl.id = 'pw-chat-badge';
    badgeEl.hidden = true;
    toggle.appendChild(badgeEl);

    panel = document.createElement('div');
    panel.id = 'pw-chat-panel';
    panel.hidden = true;

    const header = document.createElement('div');
    header.className = 'pw-chat-header';
    const title = document.createElement('span');
    title.className = 'pw-chat-title';
    title.textContent = 'Чат';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pw-chat-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => setOpen(false));
    header.append(title, closeBtn);

    listEl = document.createElement('div');
    listEl.className = 'pw-chat-messages';
    listEl.addEventListener('scroll', () => hideReactionPicker(), { passive: true });

    composerEl = document.createElement('div');
    composerEl.className = 'pw-chat-composer';

    emojiPanelEl = document.createElement('div');
    emojiPanelEl.className = 'pw-chat-emoji-panel';
    emojiPanelEl.hidden = true;
    for (const emoji of CHAT_QUICK_EMOJIS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pw-chat-emoji-panel-btn';
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        insertEmoji(emoji);
        setPickerOpen(false);
      });
      emojiPanelEl.appendChild(btn);
    }

    const form = document.createElement('form');
    form.className = 'pw-chat-composer-box';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void sendDraft();
    });

    emojiToggleBtn = document.createElement('button');
    emojiToggleBtn.type = 'button';
    emojiToggleBtn.className = 'pw-chat-emoji-toggle';
    emojiToggleBtn.title = 'Эмодзи';
    emojiToggleBtn.innerHTML = SMILEY_SVG;
    emojiToggleBtn.addEventListener('click', () => setPickerOpen(!pickerOpen));

    inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.className = 'pw-chat-input';
    inputEl.placeholder = 'Сообщение';
    inputEl.maxLength = 500;

    const sendBtn = document.createElement('button');
    sendBtn.type = 'submit';
    sendBtn.className = 'pw-chat-send-btn';
    sendBtn.title = 'Отправить';
    sendBtn.innerHTML = SEND_SVG;

    form.append(emojiToggleBtn, inputEl, sendBtn);
    composerEl.append(emojiPanelEl, form);
    panel.append(header, listEl, composerEl);
    root.append(toggle, panel);

    injectStyles();
    document.body.appendChild(root);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    onFullscreenChange();
    updateVisibility();
  }

  function injectStyles() {
    if (document.getElementById('pw-chat-styles')) return;
    const style = document.createElement('style');
    style.id = 'pw-chat-styles';
    style.textContent = `
      #pw-chat-root { position:fixed;bottom:20px;left:20px;z-index:999998;font-family:Inter,system-ui,sans-serif; }
      #pw-chat-toggle { position:relative;width:48px;height:48px;border:none;border-radius:50%;background:rgba(108,92,231,.95);color:#fff;font-size:22px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.35); }
      #pw-chat-toggle:hover { background:rgba(124,110,247,.95); }
      #pw-chat-badge { position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#e17055;color:#fff;font-size:11px;font-weight:700;line-height:18px;text-align:center; }
      #pw-chat-panel { position:absolute;bottom:58px;left:0;width:min(320px,calc(100vw - 40px));height:400px;display:flex;flex-direction:column;background:rgba(26,26,36,.98);border:1px solid #2a2a3a;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.45);overflow:hidden; }
      #pw-chat-panel[hidden] { display:none!important; }
      .pw-chat-header { display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #2a2a3a;color:#e8e8f0;font-size:13px;font-weight:600; }
      .pw-chat-close { border:none;background:transparent;color:#8888a0;font-size:22px;line-height:1;cursor:pointer;padding:0 4px; }
      .pw-chat-close:hover { color:#e8e8f0; }
      .pw-chat-messages { flex:1;overflow-y:auto;overflow-x:hidden;padding:12px 14px 16px;background:#12121a;display:flex;flex-direction:column;gap:2px; }
      .pw-chat-empty { color:#8888a0;font-size:13px;text-align:center;margin:auto;padding:1rem; }
      .pw-chat-msg { display:flex;margin-bottom:10px; }
      .pw-chat-msg.mine { justify-content:flex-end; }
      .pw-chat-inner { max-width:82%; }
      .pw-chat-bubble-wrap { position:relative;display:inline-flex;flex-direction:column;gap:5px;max-width:100%; }
      .pw-chat-msg.mine .pw-chat-bubble-wrap { align-items:flex-end; }
      .pw-chat-bubble { padding:5px 9px 4px;border-radius:12px 12px 12px 4px;background:#2a2a38;box-shadow:0 1px 2px rgba(0,0,0,.2); }
      .pw-chat-msg.mine .pw-chat-bubble { border-radius:12px 12px 4px 12px;background:linear-gradient(135deg,#5b4cdb,#6c5ce7); }
      .pw-chat-author { display:block;font-size:11px;font-weight:600;color:#8b7cf7;margin-bottom:2px; }
      .pw-chat-body { display:flex;flex-wrap:wrap;align-items:flex-end;gap:0 5px; }
      .pw-chat-text { margin:0;font-size:13px;line-height:1.35;color:#ececf4;white-space:pre-wrap;word-break:break-word; }
      .pw-chat-msg.mine .pw-chat-text { color:#fff; }
      .pw-chat-time { font-size:10px;color:rgba(255,255,255,.45);margin-left:auto;white-space:nowrap;line-height:1.4;padding-bottom:1px; }
      .pw-chat-msg:not(.mine) .pw-chat-time { color:#8888a0; }
      .pw-chat-reactions { display:flex;flex-wrap:wrap;gap:4px;max-width:100%; }
      .pw-chat-reaction-chip { display:inline-flex;align-items:center;gap:3px;padding:2px 7px 2px 5px;border-radius:12px;border:1px solid #2a2a3a;background:#1a1a24;cursor:pointer;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,.2); }
      .pw-chat-reaction-chip:hover { background:#22222f; }
      .pw-chat-reaction-chip.active { border-color:#6c5ce7;background:rgba(108,92,231,.22); }
      .pw-chat-reaction-emoji { font-size:14px;line-height:1; }
      .pw-chat-reaction-count { font-size:11px;font-weight:600;color:#8888a0;min-width:7px; }
      .pw-chat-reaction-chip.active .pw-chat-reaction-count { color:#b8adff; }
      .pw-chat-reaction-picker-float { position:fixed;z-index:999999;display:flex;gap:2px;padding:5px 8px;border-radius:22px;background:#1a1a24;border:1px solid #2a2a3a;box-shadow:0 4px 20px rgba(0,0,0,.45);white-space:nowrap;opacity:0;transform:translateY(4px) scale(.96);transition:opacity .12s ease,transform .12s ease;pointer-events:none; }
      .pw-chat-reaction-picker-float.visible { opacity:1;transform:translateY(0) scale(1);pointer-events:auto; }
      .pw-chat-reaction-picker-btn { width:32px;height:32px;border:none;border-radius:50%;background:transparent;font-size:18px;cursor:pointer;padding:0;line-height:1;flex-shrink:0; }
      .pw-chat-reaction-picker-btn:hover { background:#22222f;transform:scale(1.12); }
      .pw-chat-composer { position:relative;padding:8px;border-top:1px solid #2a2a3a; }
      .pw-chat-composer-box { display:flex;align-items:center;gap:5px;padding:5px 7px;background:#0f0f13;border:1px solid #2a2a3a;border-radius:22px; }
      .pw-chat-emoji-toggle { flex-shrink:0;width:32px;height:32px;border:none;border-radius:50%;background:transparent;color:#8888a0;cursor:pointer;display:flex;align-items:center;justify-content:center; }
      .pw-chat-emoji-toggle:hover,.pw-chat-emoji-toggle.active { color:#6c5ce7;background:rgba(108,92,231,.12); }
      .pw-chat-composer .pw-chat-input { flex:1;min-width:0;border:none;background:transparent;color:#e8e8f0;font-size:13px;outline:none;padding:6px 2px; }
      .pw-chat-send-btn { flex-shrink:0;width:32px;height:32px;border:none;border-radius:50%;background:#6c5ce7;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center; }
      .pw-chat-send-btn:hover { background:#7c6ef7; }
      .pw-chat-emoji-panel { position:absolute;bottom:calc(100% + 6px);left:8px;right:8px;display:grid;grid-template-columns:repeat(6,1fr);gap:2px;padding:8px;background:#1a1a24;border:1px solid #2a2a3a;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.4);z-index:5; }
      .pw-chat-emoji-panel[hidden] { display:none!important; }
      .pw-chat-emoji-panel-btn { border:none;border-radius:8px;background:transparent;font-size:20px;cursor:pointer;padding:4px;line-height:1; }
      .pw-chat-emoji-panel-btn:hover { background:#22222f;transform:scale(1.1); }
      #pw-chat-root.pw-chat-fullscreen { z-index:2147483646;bottom:20px;left:20px; }
      #pw-chat-root.pw-chat-fullscreen #pw-chat-toggle {
        width:38px;height:38px;font-size:17px;
        background:rgba(0,0,0,.38);
        border:1px solid rgba(255,255,255,.1);
        box-shadow:none;
        opacity:.5;
        transition:opacity .2s ease,background .2s ease,border-color .2s ease;
      }
      #pw-chat-root.pw-chat-fullscreen #pw-chat-toggle:hover,
      #pw-chat-root.pw-chat-fullscreen.pw-chat-open #pw-chat-toggle,
      #pw-chat-root.pw-chat-fullscreen.pw-chat-unread #pw-chat-toggle {
        opacity:.85;
        background:rgba(0,0,0,.52);
        border-color:rgba(255,255,255,.16);
      }
      #pw-chat-root.pw-chat-fullscreen #pw-chat-badge {
        min-width:16px;height:16px;font-size:10px;line-height:16px;
        background:rgba(200,80,60,.85);
      }
      #pw-chat-root.pw-chat-fullscreen #pw-chat-panel {
        width:min(280px,calc(100vw - 40px));
        height:min(300px,38vh);
        background:rgba(8,8,12,.48);
        backdrop-filter:blur(12px);
        -webkit-backdrop-filter:blur(12px);
        border:1px solid rgba(255,255,255,.07);
        box-shadow:0 4px 20px rgba(0,0,0,.28);
        border-radius:12px;
      }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-messages {
        background:transparent;
        padding:8px 10px 10px;
      }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-header {
        padding:7px 10px;
        font-size:11px;
        font-weight:500;
        color:rgba(255,255,255,.55);
        border-bottom-color:rgba(255,255,255,.06);
        background:transparent;
      }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-close {
        font-size:18px;color:rgba(255,255,255,.35);
      }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-close:hover { color:rgba(255,255,255,.7); }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-msg { margin-bottom:6px; }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-bubble {
        padding:4px 8px 3px;
        background:rgba(0,0,0,.32);
        box-shadow:none;
        border-radius:10px 10px 10px 3px;
      }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-msg.mine .pw-chat-bubble {
        background:rgba(255,255,255,.1);
        border-radius:10px 10px 3px 10px;
      }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-author {
        font-size:10px;font-weight:500;color:rgba(255,255,255,.4);
      }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-text { font-size:12px;color:rgba(255,255,255,.82); }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-msg.mine .pw-chat-text { color:rgba(255,255,255,.88); }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-time { font-size:9px;color:rgba(255,255,255,.28); }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-msg:not(.mine) .pw-chat-time { color:rgba(255,255,255,.28); }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-reaction-chip {
        padding:1px 5px 1px 4px;
        background:rgba(0,0,0,.28);
        border-color:rgba(255,255,255,.08);
        box-shadow:none;
      }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-reaction-chip.active {
        border-color:rgba(255,255,255,.2);
        background:rgba(255,255,255,.1);
      }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-reaction-emoji { font-size:12px; }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-reaction-count { font-size:10px;color:rgba(255,255,255,.4); }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-reaction-chip.active .pw-chat-reaction-count { color:rgba(255,255,255,.65); }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-composer {
        padding:6px 8px;
        border-top-color:rgba(255,255,255,.06);
        background:transparent;
      }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-composer-box {
        padding:4px 6px;
        background:rgba(0,0,0,.22);
        border-color:rgba(255,255,255,.08);
        border-radius:18px;
      }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-emoji-toggle { width:28px;height:28px;color:rgba(255,255,255,.35); }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-emoji-toggle:hover,
      #pw-chat-root.pw-chat-fullscreen .pw-chat-emoji-toggle.active {
        color:rgba(255,255,255,.7);
        background:rgba(255,255,255,.08);
      }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-input { font-size:12px;color:rgba(255,255,255,.75); }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-input::placeholder { color:rgba(255,255,255,.28); }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-send-btn {
        width:28px;height:28px;
        background:rgba(255,255,255,.14);
        color:rgba(255,255,255,.75);
      }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-send-btn:hover { background:rgba(255,255,255,.22); }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-reaction-picker-float,
      #pw-chat-root.pw-chat-fullscreen .pw-chat-emoji-panel {
        background:rgba(8,8,12,.72);
        border-color:rgba(255,255,255,.08);
        box-shadow:0 4px 16px rgba(0,0,0,.3);
        backdrop-filter:blur(12px);
        -webkit-backdrop-filter:blur(12px);
      }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-reaction-picker-btn { width:28px;height:28px;font-size:16px; }
      #pw-chat-root.pw-chat-fullscreen .pw-chat-empty { font-size:12px;color:rgba(255,255,255,.35); }
    `;
    document.head.appendChild(style);
  }

  function updateVisibility() {
    if (!root) return;
    const inRoom = Boolean(options.getRoomId());
    root.style.display = inRoom ? 'block' : 'none';
    if (!inRoom) setOpen(false);
  }

  function setOpen(next: boolean) {
    open = next;
    if (panel) panel.hidden = !open;
    root?.classList.toggle('pw-chat-open', open);
    if (!open) setPickerOpen(false);
    if (open) {
      unread = 0;
      updateBadge();
      scrollToBottom();
      inputEl?.focus();
    }
  }

  function updateBadge() {
    if (!badgeEl) return;
    if (unread > 0) {
      badgeEl.hidden = false;
      badgeEl.textContent = unread > 9 ? '9+' : String(unread);
      root?.classList.add('pw-chat-unread');
    } else {
      badgeEl.hidden = true;
      root?.classList.remove('pw-chat-unread');
    }
  }

  function formatTime(sentAt: number): string {
    return new Date(sentAt).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function scrollToBottom() {
    if (!listEl) return;
    listEl.scrollTop = listEl.scrollHeight;
  }

  function insertEmoji(emoji: string) {
    if (!inputEl) return;
    inputEl.value += emoji;
    inputEl.focus();
  }

  function applyReaction(messageId: string, reactions: Record<string, string[]>) {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) return;
    msg.reactions = Object.keys(reactions).length > 0 ? reactions : undefined;
    renderMessages();
  }

  async function toggleReaction(messageId: string, emoji: string) {
    try {
      await browser.runtime.sendMessage({ type: 'local-chat-reaction', messageId, emoji });
    } catch {
      // ignore
    }
  }

  function cancelReactionHide() {
    if (reactionHideTimer) {
      clearTimeout(reactionHideTimer);
      reactionHideTimer = null;
    }
  }

  function hideReactionPicker() {
    cancelReactionHide();
    reactionPickerMsgId = null;
    if (!reactionPickerEl) return;
    reactionPickerEl.classList.remove('visible');
    reactionPickerEl.hidden = true;
  }

  function scheduleReactionHide() {
    cancelReactionHide();
    reactionHideTimer = setTimeout(hideReactionPicker, REACTION_PICKER_HIDE_MS);
  }

  function ensureReactionPicker() {
    if (reactionPickerEl || !root) return;
    reactionPickerEl = document.createElement('div');
    reactionPickerEl.className = 'pw-chat-reaction-picker-float';
    reactionPickerEl.hidden = true;
    reactionPickerEl.setAttribute('role', 'toolbar');
    reactionPickerEl.setAttribute('aria-label', 'Быстрые реакции');
    for (const emoji of CHAT_REACTION_EMOJIS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pw-chat-reaction-picker-btn';
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        if (reactionPickerMsgId) void toggleReaction(reactionPickerMsgId, emoji);
        hideReactionPicker();
      });
      reactionPickerEl.appendChild(btn);
    }
    reactionPickerEl.addEventListener('mouseenter', cancelReactionHide);
    reactionPickerEl.addEventListener('mouseleave', scheduleReactionHide);
    root.appendChild(reactionPickerEl);
  }

  function positionReactionPicker(anchor: HTMLElement) {
    if (!reactionPickerEl || !listEl) return;
    const { top, left } = computeReactionPickerCoords(
      anchor.getBoundingClientRect(),
      listEl.getBoundingClientRect(),
      reactionPickerEl.offsetWidth,
      reactionPickerEl.offsetHeight
    );
    reactionPickerEl.style.top = `${top}px`;
    reactionPickerEl.style.left = `${left}px`;
  }

  function showReactionPicker(messageId: string, anchor: HTMLElement) {
    cancelReactionHide();
    ensureReactionPicker();
    reactionPickerMsgId = messageId;
    if (!reactionPickerEl) return;
    reactionPickerEl.hidden = false;
    positionReactionPicker(anchor);
    requestAnimationFrame(() => {
      positionReactionPicker(anchor);
      reactionPickerEl?.classList.add('visible');
    });
  }

  function attachReactionHover(wrap: HTMLElement, messageId: string) {
    wrap.addEventListener('mouseenter', () => showReactionPicker(messageId, wrap));
    wrap.addEventListener('mouseleave', scheduleReactionHide);
  }

  function buildMessageRow(msg: ChatMessage, userId: string | null) {
    const mine = msg.userId === userId;
    const hasReactions = Boolean(msg.reactions && Object.keys(msg.reactions).length > 0);

    const row = document.createElement('div');
    row.className = `pw-chat-msg${mine ? ' mine' : ''}`;

    const inner = document.createElement('div');
    inner.className = 'pw-chat-inner';

    const wrap = document.createElement('div');
    wrap.className = 'pw-chat-bubble-wrap';
    attachReactionHover(wrap, msg.id);

    const bubble = document.createElement('div');
    bubble.className = 'pw-chat-bubble';

    if (!mine) {
      const author = document.createElement('span');
      author.className = 'pw-chat-author';
      author.textContent = msg.userName;
      bubble.appendChild(author);
    }

    const body = document.createElement('div');
    body.className = 'pw-chat-body';

    const text = document.createElement('span');
    text.className = 'pw-chat-text';
    text.textContent = msg.text;

    const time = document.createElement('span');
    time.className = 'pw-chat-time';
    time.textContent = formatTime(msg.sentAt);

    body.append(text, time);
    bubble.appendChild(body);
    wrap.appendChild(bubble);

    if (hasReactions && msg.reactions) {
      const reactionsEl = document.createElement('div');
      reactionsEl.className = 'pw-chat-reactions';
      for (const [emoji, users] of Object.entries(msg.reactions)) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `pw-chat-reaction-chip${users.includes(userId ?? '') ? ' active' : ''}`;
        const emojiSpan = document.createElement('span');
        emojiSpan.className = 'pw-chat-reaction-emoji';
        emojiSpan.textContent = emoji;
        const countSpan = document.createElement('span');
        countSpan.className = 'pw-chat-reaction-count';
        countSpan.textContent = String(users.length);
        chip.append(emojiSpan, countSpan);
        chip.addEventListener('click', () => void toggleReaction(msg.id, emoji));
        reactionsEl.appendChild(chip);
      }
      wrap.appendChild(reactionsEl);
    }

    inner.appendChild(wrap);
    row.appendChild(inner);
    return row;
  }

  function renderMessages() {
    if (!listEl) return;
    hideReactionPicker();
    listEl.replaceChildren();

    if (messages.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'pw-chat-empty';
      empty.textContent = 'Пока тихо — напишите первым';
      listEl.appendChild(empty);
      return;
    }

    const userId = options.getUserId();
    for (const msg of messages) {
      listEl.appendChild(buildMessageRow(msg, userId));
    }

    scrollToBottom();
  }

  function addMessage(msg: ChatMessage) {
    if (seenIds.has(msg.id)) return;
    seenIds.add(msg.id);
    messages.push(msg);
    if (messages.length > 100) {
      const removed = messages.splice(0, messages.length - 100);
      for (const m of removed) seenIds.delete(m.id);
    }
    renderMessages();
    if (!open && msg.userId !== options.getUserId()) {
      unread += 1;
      updateBadge();
      playChatNotificationSound();
      if (document.hidden) {
        notifyChatMessage(msg.userName, msg.text.slice(0, 120));
      }
    }
  }

  async function sendDraft() {
    const text = inputEl?.value.trim();
    if (!text || !options.getRoomId()) return;
    inputEl!.value = '';
    setPickerOpen(false);
    try {
      await browser.runtime.sendMessage({ type: 'local-chat', text });
    } catch {
      inputEl!.value = text;
    }
  }

  function setRoomId(roomId: string | null) {
    if (roomId) ensureDom();
    const title = panel?.querySelector('.pw-chat-title');
    if (title) {
      title.textContent = roomId ? `Чат · ${roomId}` : 'Чат';
    }
    updateVisibility();
    if (!roomId) clear();
  }

  function clear() {
    messages.length = 0;
    seenIds.clear();
    unread = 0;
    updateBadge();
    renderMessages();
  }

  function handleMessage(message: Record<string, unknown>) {
    ensureDom();
    if (message.type === 'chat-history') {
      const history = (message.chatHistory as ChatMessage[] | undefined) ?? [];
      clear();
      for (const msg of history) addMessage(msg);
      if (history.length === 0) renderMessages();
      return;
    }
    if (message.type === 'chat-message') {
      addMessage(message.chat as ChatMessage);
      return;
    }
    if (message.type === 'chat-reaction') {
      const messageId = message.messageId as string;
      const reactions = message.reactions as Record<string, string[]>;
      if (messageId && reactions) applyReaction(messageId, reactions);
      return;
    }
    if (message.type === 'chat-clear') {
      clear();
    }
  }

  function destroy() {
    document.removeEventListener('mousedown', onDocClick);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    clear();
    root?.remove();
    root = null;
    panel = null;
    listEl = null;
    badgeEl = null;
    inputEl = null;
    composerEl = null;
    emojiPanelEl = null;
    emojiToggleBtn = null;
    document.getElementById('pw-chat-styles')?.remove();
  }

  return {
    handleMessage,
    setRoomId,
    clear,
    destroy,
    updateVisibility,
  };
}
