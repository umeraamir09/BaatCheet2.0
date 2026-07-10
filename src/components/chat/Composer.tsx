import { forwardRef, useRef, useState } from "react";
import { ImagePlus, Laugh, Send, X } from "lucide-react";
import { MAX_MESSAGE_LEN } from "./MessageBubble";
import { EmojiPicker } from "./EmojiPicker";
import { GifPicker } from "./GifPicker";
import { hasGiphyKey } from "../../lib/giphy";
import { IconButton } from "../ui/IconButton";

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
  editingMessage?: boolean;
  onCancelEdit?: () => void;
}

export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(
  {
    value,
    onChange,
    onKeyDown,
    onSend,
    disabled,
    placeholder = "Type a message",
    onEmojiInsert,
    onGifSelect,
    onImageSelect,
    pendingImage,
    pendingImagePreview,
    onClearImage,
    pendingGif,
    onClearGif,
    editingMessage = false,
    onCancelEdit,
  },
  ref,
) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasContent = Boolean(value.trim() || pendingImage || pendingGif);

  const handleEmojiSelect = (emoji: string) => {
    onEmojiInsert(emoji);
    setShowEmojiPicker(false);
  };

  const handleGifSelect = (gif: GifAttachment) => {
    onGifSelect(gif);
    setShowGifPicker(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onImageSelect(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="border-t border-discord-border bg-discord-bg px-4 pb-4 pt-3">
      {editingMessage && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-discord-control px-3 py-2 text-sm text-discord-text">
          <span>Editing message</span>
          <button
            type="button"
            onClick={onCancelEdit}
            className="text-discord-muted hover:text-discord-text"
          >
            Cancel
          </button>
        </div>
      )}
      {(pendingImagePreview || pendingGif) && (
        <div className="mb-3 flex gap-2 rounded-xl bg-discord-surface p-2">
          {pendingImagePreview && (
            <PendingPreview src={pendingImagePreview} alt="Pending upload" onClear={onClearImage} />
          )}
          {pendingGif && (
            <PendingPreview src={pendingGif.url} alt={pendingGif.alt} onClear={onClearGif} />
          )}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-2xl bg-discord-surface px-2 py-2 ring-1 ring-discord-border focus-within:ring-discord-focus">
        <IconButton
          label="Upload image"
          variant="ghost"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus size={18} />
        </IconButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />

        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, MAX_MESSAGE_LEN))}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={1}
          className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-5 text-discord-text placeholder:text-discord-subtle focus:outline-none"
        />

        <div className="relative">
          <IconButton
            label="Emoji"
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowEmojiPicker(!showEmojiPicker);
              setShowGifPicker(false);
            }}
          >
            <Laugh size={18} />
          </IconButton>
          {showEmojiPicker && (
            <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmojiPicker(false)} />
          )}
        </div>

        {hasGiphyKey() && (
          <div className="relative">
            <IconButton
              label="GIF"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowGifPicker(!showGifPicker);
                setShowEmojiPicker(false);
              }}
            >
              <span className="text-[10px] font-bold tracking-wide">GIF</span>
            </IconButton>
            {showGifPicker && (
              <GifPicker onSelect={handleGifSelect} onClose={() => setShowGifPicker(false)} />
            )}
          </div>
        )}

        <IconButton
          label="Send message"
          variant={hasContent ? "selected" : "default"}
          size="sm"
          onClick={onSend}
          disabled={disabled || !hasContent}
        >
          <Send size={17} />
        </IconButton>
      </div>
    </div>
  );
});

function PendingPreview({ src, alt, onClear }: { src: string; alt: string; onClear: () => void }) {
  return (
    <div className="relative">
      <img src={src} alt={alt} className="h-16 w-16 rounded-lg object-cover" />
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove ${alt}`}
        title={`Remove ${alt}`}
        className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-discord-danger text-white shadow hover:bg-discord-danger-hover"
      >
        <X size={14} />
      </button>
    </div>
  );
}
