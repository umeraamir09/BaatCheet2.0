/**
 * RichContent — renders message text with clickable links and Apple-style emojis.
 *
 * Parses message text for links and known emoji graphemes. Links are rendered as
 * clickable anchors; emoji graphemes are rendered through emoji-mart's Apple set
 * using a bundled local spritesheet for consistent cross-platform visuals.
 */
import { find } from "linkifyjs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isKnownEmoji } from "../../lib/emoji";
import { AppleEmoji } from "./AppleEmoji";

interface RichContentProps {
  text: string;
}

interface Segment {
  type: "text" | "link" | "emoji";
  value: string;
  href?: string;
}

type GraphemeSegment = { segment: string };
type GraphemeSegmenter = {
  segment: (input: string) => Iterable<GraphemeSegment>;
};
type IntlWithSegmenter = typeof Intl & {
  Segmenter?: new (
    locales?: string | string[],
    options?: { granularity: "grapheme" },
  ) => GraphemeSegmenter;
};

/**
 * Parse text into segments: plain text, links, and emojis.
 */
function splitTextToEmojiSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const segmenterCtor = (Intl as IntlWithSegmenter).Segmenter;
  const graphemes = segmenterCtor
    ? Array.from(new segmenterCtor(undefined, { granularity: "grapheme" }).segment(text)).map(
        ({ segment }) => segment,
      )
    : Array.from(text);

  let textBuffer = "";
  for (const grapheme of graphemes) {
    if (isKnownEmoji(grapheme)) {
      if (textBuffer) {
        segments.push({ type: "text", value: textBuffer });
        textBuffer = "";
      }
      segments.push({ type: "emoji", value: grapheme });
      continue;
    }
    textBuffer += grapheme;
  }

  if (textBuffer) {
    segments.push({ type: "text", value: textBuffer });
  }

  return segments;
}

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];

  // Find all links using linkifyjs
  const links = find(text);

  if (links.length === 0) {
    // No links — split text and known emoji graphemes
    segments.push(...splitTextToEmojiSegments(text));
    return segments;
  }

  // Build segments around the links
  let lastIndex = 0;
  for (const link of links) {
    // Add text before the link
    if (link.start > lastIndex) {
      const beforeLink = text.slice(lastIndex, link.start);
      segments.push(...splitTextToEmojiSegments(beforeLink));
    }
    // Add the link
    segments.push({
      type: "link",
      value: link.value,
      href: link.href,
    });
    lastIndex = link.end;
  }

  // Add remaining text after the last link
  if (lastIndex < text.length) {
    const trailingText = text.slice(lastIndex);
    segments.push(...splitTextToEmojiSegments(trailingText));
  }

  return segments;
}

/**
 * Handle link click — open in system browser.
 */
function handleLinkClick(href: string) {
  openUrl(href).catch((err) => {
    console.error("Failed to open URL:", err);
  });
}

export function RichContent({ text }: RichContentProps) {
  const segments = parseSegments(text);

  return (
    <span className="whitespace-pre-wrap break-words">
      {segments.map((segment, i) => {
        if (segment.type === "link") {
          return (
            <a
              key={i}
              href={segment.href}
              onClick={(e) => {
                e.preventDefault();
                if (segment.href) handleLinkClick(segment.href);
              }}
              className="text-discord-light-blurple underline hover:text-discord-blurple-hover cursor-pointer"
              target="_blank"
              rel="noopener noreferrer"
            >
              {segment.value}
            </a>
          );
        }
        if (segment.type === "emoji") {
          return <AppleEmoji key={i} native={segment.value} />;
        }
        return <span key={i}>{segment.value}</span>;
      })}
    </span>
  );
}
