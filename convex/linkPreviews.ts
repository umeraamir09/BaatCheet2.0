/**
 * Rich messaging — Link preview fetching (OpenGraph metadata).
 *
 * `fetchLinkPreview` is a Convex action (server-side, no CORS) that fetches
 * a URL, parses HTML for OG meta tags, and stores the result on the message
 * via `storeLinkPreview` internal mutation.
 *
 * Scheduled by `sendMessage` when a URL is detected in the message body.
 * The preview appears reactively ~1-3s after the message is sent.
 */
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const FETCH_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Fetch a URL and extract OpenGraph metadata. Scheduled by `sendMessage`
 * when a URL is detected. Stores the result (or null if no OG data found)
 * on the message doc.
 */
export const fetchLinkPreview = internalAction({
  args: {
    messageId: v.id("messages"),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(args.url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "BaatCheet/1.0 (Link Preview Bot)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      clearTimeout(timer);

      if (!response.ok) {
        await ctx.runMutation(internal.linkPreviews.storeLinkPreview, {
          messageId: args.messageId,
          preview: null,
        });
        return;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        await ctx.runMutation(internal.linkPreviews.storeLinkPreview, {
          messageId: args.messageId,
          preview: null,
        });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        await ctx.runMutation(internal.linkPreviews.storeLinkPreview, {
          messageId: args.messageId,
          preview: null,
        });
        return;
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalBytes += value.length;
        if (totalBytes > MAX_BODY_BYTES) break;
      }

      const decoder = new TextDecoder("utf-8");
      const html = chunks.map((c) => decoder.decode(c, { stream: true })).join("");

      const og = parseOpenGraph(html);

      await ctx.runMutation(internal.linkPreviews.storeLinkPreview, {
        messageId: args.messageId,
        preview: og
          ? {
              url: args.url,
              title: og.title,
              description: og.description,
              imageUrl: og.imageUrl,
              siteName: og.siteName,
              fetchedAt: Date.now(),
            }
          : null,
      });
    } catch {
      await ctx.runMutation(internal.linkPreviews.storeLinkPreview, {
        messageId: args.messageId,
        preview: null,
      });
    }
  },
});

/**
 * Store the fetched link preview on the message doc. Internal — only callable
 * from the `fetchLinkPreview` action.
 */
export const storeLinkPreview = internalMutation({
  args: {
    messageId: v.id("messages"),
    preview: v.union(
      v.object({
        url: v.string(),
        title: v.union(v.string(), v.null()),
        description: v.union(v.string(), v.null()),
        imageUrl: v.union(v.string(), v.null()),
        siteName: v.union(v.string(), v.null()),
        fetchedAt: v.number(),
      }),
      v.null(),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { linkPreview: args.preview });
  },
});

interface OpenGraphData {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
}

/**
 * Parse OpenGraph meta tags from HTML. Returns null if no useful data found.
 * Also extracts <title> as fallback for og:title.
 */
function parseOpenGraph(html: string): OpenGraphData | null {
  const getMeta = (property: string): string | null => {
    const patterns = [
      new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, "i"),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return decodeHtmlEntities(match[1]);
    }
    return null;
  };

  const title = getMeta("og:title");
  const description = getMeta("og:description");
  const imageUrl = getMeta("og:image");
  const siteName = getMeta("og:site_name");

  const fallbackTitle = title ?? extractTitleTag(html);

  if (!fallbackTitle && !description && !imageUrl) {
    return null;
  }

  return {
    title: fallbackTitle ?? null,
    description: description ?? null,
    imageUrl: imageUrl ?? null,
    siteName: siteName ?? null,
  };
}

function extractTitleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1] ? decodeHtmlEntities(match[1]) : null;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}
