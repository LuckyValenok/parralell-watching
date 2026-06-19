export type ChatReactions = Record<string, string[]>;

export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  text: string;
  sentAt: number;
  reactions?: ChatReactions;
}

/** Быстрая вставка в поле ввода */
export const CHAT_QUICK_EMOJIS = [
  '😀', '😂', '❤️', '👍', '👎', '🔥', '😮', '😢', '🎉', '💀', '🍿', '👀',
] as const;

/** Реакции на сообщения */
export const CHAT_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉'] as const;

const REACTION_SET = new Set<string>(CHAT_REACTION_EMOJIS);

export function isAllowedReaction(emoji: string): boolean {
  return REACTION_SET.has(emoji);
}

/** Задержка перед скрытием панели быстрых реакций (мс) */
export const REACTION_PICKER_HIDE_MS = 400;

export const REACTION_PICKER_ESTIMATED_WIDTH = 288;
export const REACTION_PICKER_ESTIMATED_HEIGHT = 42;

export interface ReactionPickerCoords {
  top: number;
  left: number;
}

/** Позиция плавающей панели: над пузырём, если хватает места, иначе под ним; по горизонтали — в границах списка */
export function computeReactionPickerCoords(
  anchor: DOMRect,
  bounds: DOMRect,
  pickerWidth: number,
  pickerHeight: number,
  gap = 6
): ReactionPickerCoords {
  const pw = pickerWidth || REACTION_PICKER_ESTIMATED_WIDTH;
  const ph = pickerHeight || REACTION_PICKER_ESTIMATED_HEIGHT;
  const pad = 6;

  const centerX = anchor.left + anchor.width / 2;
  let left = centerX - pw / 2;
  left = Math.max(bounds.left + pad, Math.min(left, bounds.right - pw - pad));

  const spaceAbove = anchor.top - bounds.top;
  const spaceBelow = bounds.bottom - anchor.bottom;
  const placeAbove = spaceAbove >= ph + gap || spaceAbove > spaceBelow;

  const top = placeAbove ? anchor.top - ph - gap : anchor.bottom + gap;
  return { top, left };
}
