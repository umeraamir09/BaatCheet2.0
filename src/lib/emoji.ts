/**
 * Emoji reverse map — native Unicode character → emoji-mart data.
 *
 * Built once at module load from `@emoji-mart/data`. Used by `RichContent`
 * to look up emoji characters in message text and render them as Apple-style
 * images via emoji-mart's `<Emoji>` component.
 */
import type { EmojiMartData } from "@emoji-mart/data";
import appleData from "@emoji-mart/data/sets/15/apple.json";

export interface EmojiInfo {
  id: string;
  name: string;
}

const nativeToEmoji = new Map<string, EmojiInfo>();

const emojiData = appleData as unknown as EmojiMartData;
for (const [id, emoji] of Object.entries(emojiData.emojis)) {
  const native = emoji.skins[0]?.native;
  if (native) {
    nativeToEmoji.set(native, { id, name: emoji.name });
  }
}

/**
 * Look up an emoji by its native Unicode character. Returns the emoji-mart
 * id + name if found, or null if not in the dataset.
 */
export function findEmojiByNative(char: string): EmojiInfo | null {
  return nativeToEmoji.get(char) ?? null;
}

/**
 * Check if a character is a known emoji in the dataset.
 */
export function isKnownEmoji(char: string): boolean {
  return nativeToEmoji.has(char);
}
