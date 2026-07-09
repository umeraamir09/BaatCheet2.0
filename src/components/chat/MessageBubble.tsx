import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { RichContent } from "./RichContent";
import { LinkPreviewCard, type LinkPreview } from "./LinkPreviewCard";

/** A single message from the reactive `listMessages` query. */
export type MessageEntry = NonNullable<
  FunctionReturnType<typeof api.messages.listMessages>
>[number];

/** Max message body length — must match convex/messages.ts and useChatThread. */
export const MAX_MESSAGE_LEN = 4000;

interface MessageBubbleProps {
  message: MessageEntry;
  mine: boolean;
}

/**
 * A single message bubble — own right-aligned, peer left-aligned.
 * Renders text (with clickable links), images, GIFs, and link preview cards.
 * Extracted from DMThread (Phase 3) for reuse in LobbyThread (Phase 5).
 */
export function MessageBubble({ message, mine }: MessageBubbleProps) {
  const name = message.sender?.displayName ?? message.sender?.username ?? "Unknown";
  const hasText = message.body.trim().length > 0;
  const hasAttachments = message.attachments && message.attachments.length > 0;
  const hasLinkPreview = message.linkPreview != null;

  if (mine) {
    return (
      <div className="mb-2 flex justify-end">
        <div className="max-w-[70%]">
          {/* Attachments (images / GIFs) */}
          {hasAttachments && (
            <div className="mb-1 flex flex-col gap-1">
              {message.attachments!.map((att, i) => (
                <AttachmentRenderer key={i} attachment={att} />
              ))}
            </div>
          )}
          {/* Text body */}
          {hasText && (
            <div className="rounded-2xl rounded-br-sm bg-discord-blurple px-3 py-2 text-white">
              <RichContent text={message.body} />
            </div>
          )}
          {/* Link preview */}
          {hasLinkPreview && message.linkPreview && (
            <LinkPreviewCard preview={message.linkPreview as LinkPreview} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2 flex items-end gap-2">
      <img
        src={message.sender?.avatarUrl}
        alt={`${name} avatar`}
        className="h-8 w-8 shrink-0 rounded-full"
      />
      <div className="max-w-[70%]">
        <p className="mb-0.5 text-xs font-medium text-white/80">{name}</p>
        {/* Attachments (images / GIFs) */}
        {hasAttachments && (
          <div className="mb-1 flex flex-col gap-1">
            {message.attachments!.map((att, i) => (
              <AttachmentRenderer key={i} attachment={att} />
            ))}
          </div>
        )}
        {/* Text body */}
        {hasText && (
          <div className="rounded-2xl rounded-bl-sm bg-discord-surface px-3 py-2 text-white">
            <RichContent text={message.body} />
          </div>
        )}
        {/* Link preview */}
        {hasLinkPreview && message.linkPreview && (
          <LinkPreviewCard preview={message.linkPreview as LinkPreview} />
        )}
      </div>
    </div>
  );
}

/** Renders a single attachment (image or GIF). */
function AttachmentRenderer({
  attachment,
}: {
  attachment: NonNullable<MessageEntry["attachments"]>[number];
}) {
  if (attachment.kind === "image") {
    const url = attachment.url;
    if (!url) {
      return <div className="h-32 w-32 animate-pulse rounded-lg bg-discord-surface" />;
    }
    return (
      <img
        src={url}
        alt="Uploaded image"
        className="max-h-[300px] max-w-[300px] rounded-lg object-contain"
        loading="lazy"
      />
    );
  }

  // GIF
  return (
    <img
      src={attachment.url}
      alt={attachment.alt ?? "GIF"}
      className="max-h-[300px] max-w-[300px] rounded-lg"
      loading="lazy"
    />
  );
}
