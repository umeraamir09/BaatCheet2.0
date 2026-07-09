import { useCallback, useRef, useState } from "react";
import type { GifAttachment } from "../components/chat/Composer";
import type { SendAttachment } from "../hooks/useChatThread";

/**
 * Shared composer state hook — manages pending image, pending GIF, and
 * emoji insertion at cursor position. Used by both DMThread and LobbyThread
 * to avoid duplicating this logic.
 */
export function useComposerState(textareaRef: React.RefObject<HTMLTextAreaElement | null>) {
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingImagePreview, setPendingImagePreview] = useState<string | null>(null);
  const [pendingGif, setPendingGif] = useState<GifAttachment | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const handleImageSelect = useCallback((file: File) => {
    // Revoke previous object URL
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setPendingImage(file);
    setPendingImagePreview(url);
    // Clear any pending GIF when an image is selected
    setPendingGif(null);
  }, []);

  const handleClearImage = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPendingImage(null);
    setPendingImagePreview(null);
  }, []);

  const handleGifSelect = useCallback((gif: GifAttachment) => {
    setPendingGif(gif);
    // Clear any pending image when a GIF is selected
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPendingImage(null);
    setPendingImagePreview(null);
  }, []);

  const handleClearGif = useCallback(() => {
    setPendingGif(null);
  }, []);

  const handleEmojiInsert = useCallback(
    (emoji: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      const newValue = value.slice(0, start) + emoji + value.slice(end);
      // Dispatch a synthetic input event so the parent's onChange fires
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      nativeInputValueSetter?.call(textarea, newValue);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      // Move cursor after the inserted emoji
      requestAnimationFrame(() => {
        textarea.selectionStart = start + emoji.length;
        textarea.selectionEnd = start + emoji.length;
        textarea.focus();
      });
    },
    [textareaRef],
  );

  /** Build the SendAttachment[] array from pending image/GIF state. */
  const buildAttachments = useCallback((): SendAttachment[] | undefined => {
    const attachments: SendAttachment[] = [];
    if (pendingImage) {
      attachments.push({ kind: "image", file: pendingImage });
    }
    if (pendingGif) {
      attachments.push({
        kind: "gif",
        url: pendingGif.url,
        width: pendingGif.width,
        height: pendingGif.height,
        alt: pendingGif.alt,
      });
    }
    return attachments.length > 0 ? attachments : undefined;
  }, [pendingImage, pendingGif]);

  /** Clear all pending attachments after a successful send. */
  const clearAttachments = useCallback(() => {
    handleClearImage();
    handleClearGif();
  }, [handleClearImage, handleClearGif]);

  return {
    pendingImage,
    pendingImagePreview,
    pendingGif,
    handleImageSelect,
    handleClearImage,
    handleGifSelect,
    handleClearGif,
    handleEmojiInsert,
    buildAttachments,
    clearAttachments,
  };
}
