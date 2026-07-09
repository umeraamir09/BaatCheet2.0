import { useEffect, useRef } from "react";
import { Emoji } from "emoji-mart";
import data from "@emoji-mart/data";
import { getAppleSpritesheetURL } from "../../lib/emojiSpritesheet";

interface AppleEmojiProps {
  native: string;
  size?: string;
}

export function AppleEmoji({ native, size = "1.2em" }: AppleEmojiProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const instanceRef = useRef<Emoji | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    container.innerHTML = "";
    instanceRef.current = new Emoji({
      native,
      set: "apple",
      data,
      size,
      getSpritesheetURL: getAppleSpritesheetURL,
      ref: containerRef,
    });
    return () => {
      container.innerHTML = "";
      instanceRef.current = null;
    };
  }, [native, size]);

  return <span ref={containerRef} className="inline-block align-middle" />;
}
