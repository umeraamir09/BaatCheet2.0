import { findEmojiByNative } from "../../lib/emoji";
import { getAppleSpritesheetURL } from "../../lib/emojiSpritesheet";

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
        backgroundPosition: `${(emoji.sheetX / 61) * 100}% ${(emoji.sheetY / 61) * 100}%`,
        backgroundSize: "6200% 6200%",
      }}
    />
  );
}
