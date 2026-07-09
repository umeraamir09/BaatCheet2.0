/**
 * Emoji reverse map — native Unicode character → emoji-mart data.
 *
 * Built once at module load from `@emoji-mart/data`. Used by `RichContent`
 * to look up emoji characters in message text and render them as Apple-style
 * images via emoji-mart's `<Emoji>` component.
 */
import type { EmojiMartData } from "@emoji-mart/data";
import appleData from "@emoji-mart/data/sets/15/apple.json";
import appleEmojiData from "emoji-datasource-apple/emoji.json";

export interface EmojiInfo {
  id: string;
  name: string;
  sheetX: number;
  sheetY: number;
}

const nativeToEmoji = new Map<string, EmojiInfo>();

interface AppleEmojiDatum {
  unified: string;
  non_qualified: string | null;
  sheet_x: number;
  sheet_y: number;
  has_img_apple: boolean;
}

const unifiedToSheet = new Map<string, { sheetX: number; sheetY: number }>();

for (const emoji of appleEmojiData as AppleEmojiDatum[]) {
  if (!emoji.has_img_apple) {
    continue;
  }
  const sheet = { sheetX: emoji.sheet_x, sheetY: emoji.sheet_y };
  unifiedToSheet.set(emoji.unified.toLowerCase(), sheet);
  if (emoji.non_qualified) {
    unifiedToSheet.set(emoji.non_qualified.toLowerCase(), sheet);
  }
}

const emojiData = appleData as unknown as EmojiMartData;
for (const [id, emoji] of Object.entries(emojiData.emojis)) {
  for (const skin of emoji.skins) {
    const native = skin.native;
    const sheet = unifiedToSheet.get(skin.unified.toLowerCase());
    if (native && sheet) {
      nativeToEmoji.set(native, { id, name: emoji.name, ...sheet });
    }
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
