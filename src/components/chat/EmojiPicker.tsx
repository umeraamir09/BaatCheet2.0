/**
 * EmojiPicker — Apple-style emoji picker using emoji-mart.
 *
 * Wraps the emoji-mart Picker component with dark theme and Apple emoji set.
 * When an emoji is selected, it's inserted at the textarea cursor position.
 */
import { useEffect, useRef } from "react";
import Picker from "@emoji-mart/react";
import appleData from "@emoji-mart/data/sets/15/apple.json";
import { getAppleSpritesheetURL } from "../../lib/emojiSpritesheet";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div ref={pickerRef} className="absolute bottom-full right-0 z-50 mb-2 shadow-xl">
      <Picker
        data={appleData}
        set="apple"
        getSpritesheetURL={getAppleSpritesheetURL}
        theme="dark"
        onEmojiSelect={(emoji: { native: string }) => {
          onSelect(emoji.native);
        }}
        previewPosition="none"
        skinTonePosition="search"
        searchPosition="sticky"
      />
    </div>
  );
}
