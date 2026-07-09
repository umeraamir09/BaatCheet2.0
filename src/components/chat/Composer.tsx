import { forwardRef, useRef, useState } from "react";
import { MAX_MESSAGE_LEN } from "./MessageBubble";
import { EmojiPicker } from "./EmojiPicker";
import { GifPicker } from "./GifPicker";
import { hasGiphyKey } from "../../lib/giphy";

export interface GifAttachment {
  url: string;
  width: number;
  height: number;
  alt: string;
}

interface ComposerProps {
  value: string;
  onChange: (text: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  disabled: boolean;
  placeholder?: string;
  onEmojiInsert: (emoji: string) => void;
  onGifSelect: (gif: GifAttachment) => void;
  onImageSelect: (file: File) => void;
  pendingImage: File | null;
  pendingImagePreview: string | null;
  onClearImage: () => void;
  pendingGif: GifAttachment | null;
  onClearGif: () => void;
}

/**
 * Message composer — Enter sends, Shift+Enter newline.
 * Includes toolbar for emoji picker, GIF picker, and image upload.
 * Extracted from DMThread (Phase 3) for reuse in LobbyThread (Phase 5).
 *
 * Uses forwardRef so the parent can pass a ref to the textarea for
 * emoji insertion at cursor position.
 */
export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(
  {
    value,
    onChange,
    onKeyDown,
    onSend,
    disabled,
    placeholder = "Type a message…",
    onEmojiInsert,
    onGifSelect,
    onImageSelect,
    pendingImage,
    pendingImagePreview,
    onClearImage,
    pendingGif,
    onClearGif,
  },
  ref,
) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasContent = value.trim() || pendingImage || pendingGif;

  const handleEmojiSelect = (emoji: string) => {
    onEmojiInsert(emoji);
    setShowEmojiPicker(false);
  };

  const handleGifSelect = (gif: GifAttachment) => {
    onGifSelect(gif);
    setShowGifPicker(false);
  };

  const handleImageClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImageSelect(file);
    }
    // Reset the input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="relative border-t border-white/8">
      {/* Pending attachments preview */}
      {(pendingImagePreview || pendingGif) && (
        <div className="flex gap-2 px-4 pt-2">
          {pendingImagePreview && (
            <div className="relative">
              <img
                src={pendingImagePreview}
                alt="Pending"
                className="h-16 w-16 rounded object-cover"
              />
              <button
                onClick={onClearImage}
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs text-white hover:bg-red-700"
              >
                ×
              </button>
            </div>
          )}
          {pendingGif && (
            <div className="relative">
              <img
                src={pendingGif.url}
                alt={pendingGif.alt}
                className="h-16 w-16 rounded object-cover"
              />
              <button
                onClick={onClearGif}
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs text-white hover:bg-red-700"
              >
                ×
              </button>
            </div>
          )}
        </div>
      )}

      {/* Toolbar + textarea */}
      <div className="flex items-end gap-2 px-4 py-3">
        {/* Toolbar buttons */}
        <div className="flex items-center gap-1 pb-1">
          {/* Emoji button */}
          <div className="relative">
            <button
              onClick={() => {
                setShowEmojiPicker(!showEmojiPicker);
                setShowGifPicker(false);
              }}
              className="rounded p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
              title="Emoji"
            >
              <EmojiIcon />
            </button>
            {showEmojiPicker && (
              <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmojiPicker(false)} />
            )}
          </div>

          {/* GIF button */}
          {hasGiphyKey() && (
            <div className="relative">
              <button
                onClick={() => {
                  setShowGifPicker(!showGifPicker);
                  setShowEmojiPicker(false);
                }}
                className="rounded p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
                title="GIF"
              >
                <GifIcon />
              </button>
              {showGifPicker && (
                <GifPicker onSelect={handleGifSelect} onClose={() => setShowGifPicker(false)} />
              )}
            </div>
          )}

          {/* Image upload button */}
          <button
            onClick={handleImageClick}
            className="rounded p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
            title="Upload image"
          >
            <ImageIcon />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* Textarea */}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, MAX_MESSAGE_LEN))}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={1}
          className="max-h-32 flex-1 resize-none rounded bg-discord-surface px-3 py-2 text-sm text-white/90 placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-discord-blurple"
        />
        <button
          onClick={onSend}
          disabled={disabled || !hasContent}
          className="rounded bg-discord-blurple px-4 py-2 text-sm font-medium text-white hover:bg-discord-blurple-hover disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
});

function EmojiIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  );
}

function GifIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <text
        x="12"
        y="15"
        textAnchor="middle"
        fontSize="8"
        fill="currentColor"
        stroke="none"
        fontWeight="bold"
      >
        GIF
      </text>
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}
