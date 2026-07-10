import { findEmojiByNative } from "../../lib/emoji";
import { getAppleSpritesheetURL } from "../../lib/emojiSpritesheet";

// Must match `sheet` in @emoji-mart/data/sets/15/apple.json.
const SPRITE_SHEET_COLUMNS = 61;
const SPRITE_SHEET_LAST_INDEX = SPRITE_SHEET_COLUMNS - 1;

interface AppleEmojiProps {
  native: string;
  size?: string;
}

export function AppleEmoji({ native, size = "1.2em" }: AppleEmojiProps) {
  const emoji = findEmojiByNative(native);

  if (!emoji) {
    return <>{native}</>;
  }

  return (
    <span
      role="img"
      aria-label={emoji.name}
      title={emoji.name}
      className="inline-block align-[-0.18em] shrink-0"
      style={{
        width: size,
        height: size,
        backgroundImage: `url("${getAppleSpritesheetURL()}")`,
        backgroundPosition: `${(emoji.sheetX / SPRITE_SHEET_LAST_INDEX) * 100}% ${(emoji.sheetY / SPRITE_SHEET_LAST_INDEX) * 100}%`,
        backgroundSize: `${SPRITE_SHEET_COLUMNS * 100}% ${SPRITE_SHEET_COLUMNS * 100}%`,
      }}
    />
  );
}
