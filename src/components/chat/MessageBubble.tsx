import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { isEmojiOnlyText, RichContent } from "./RichContent";
import { LinkPreviewCard, type LinkPreview } from "./LinkPreviewCard";

/** A single message from the reactive `listMessages` query. */
export type MessageEntry = NonNullable<
  FunctionReturnType<typeof api.messages.listMessages>
>[number];

/** Max message body length - must match convex/messages.ts and useChatThread. */
export const MAX_MESSAGE_LEN = 4000;

interface MessageBubbleProps {
  message: MessageEntry;
  previousMessage?: MessageEntry | null;
}

/**
 * Discord-style message row shared by DMs and the lobby.
 * Every message is left aligned; consecutive messages from the same sender are
 * compacted by hiding the repeated avatar/name/timestamp.
 */
export function MessageBubble({ message, previousMessage }: MessageBubbleProps) {
  const name = message.sender?.displayName ?? message.sender?.username ?? "Unknown";
  const hasText = message.body.trim().length > 0;
  const hasAttachments = message.attachments && message.attachments.length > 0;
  const hasLinkPreview = message.linkPreview != null;
  const grouped = isGroupedMessage(message, previousMessage);
  const emojiOnly = hasText && isEmojiOnlyText(message.body);

  return (
    <div
      className={`group flex gap-3 px-4 hover:bg-white/[0.025] ${grouped ? "py-0.5" : "pt-3 pb-1"}`}
    >
      <div className="w-10 shrink-0">
        {!grouped &&
          (message.sender?.avatarUrl ? (
            <img
              src={message.sender.avatarUrl}
              alt={`${name} avatar`}
              className="h-10 w-10 rounded-full"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-discord-blurple text-sm font-semibold text-white">
              {name.charAt(0).toUpperCase()}
            </div>
          ))}
      </div>

      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="mb-0.5 flex items-baseline gap-2">
            <span className="font-semibold leading-5 text-discord-text">{name}</span>
            <time className="text-xs leading-5 text-discord-subtle">
              {formatMessageTime(message.createdAt)}
            </time>
          </div>
        )}

        {hasAttachments && (
          <div className="mb-1 flex flex-col gap-1">
            {message.attachments!.map((att, i) => (
              <AttachmentRenderer key={i} attachment={att} />
            ))}
          </div>
        )}

        {hasText && (
          <div
            className={`max-w-[72ch] whitespace-pre-wrap break-words text-discord-text ${
              emojiOnly ? "text-[15px] leading-none" : "text-[15px] leading-5"
            }`}
          >
            <RichContent text={message.body} />
          </div>
        )}

        {hasLinkPreview && message.linkPreview && (
          <LinkPreviewCard preview={message.linkPreview as LinkPreview} />
        )}
      </div>
    </div>
  );
}

function isGroupedMessage(message: MessageEntry, previousMessage?: MessageEntry | null): boolean {
  if (!previousMessage || previousMessage.senderId !== message.senderId) return false;
  const diff = message.createdAt - previousMessage.createdAt;
  return diff >= 0 && diff < 5 * 60 * 1000;
}

function formatMessageTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
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
        className="max-h-[300px] max-w-[360px] rounded-lg object-contain"
        loading="lazy"
      />
    );
  }

  return (
    <img
      src={attachment.url}
      alt={attachment.alt ?? "GIF"}
      className="max-h-[300px] max-w-[360px] rounded-lg"
      loading="lazy"
    />
  );
}
