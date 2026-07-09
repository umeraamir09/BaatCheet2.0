/**
 * LinkPreviewCard — displays a rich preview card for a URL.
 *
 * Shows the site name, title, description, and optional thumbnail image.
 * Clicking the card opens the URL in the system browser.
 */
import { openUrl } from "@tauri-apps/plugin-opener";

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  fetchedAt: number;
}

interface LinkPreviewCardProps {
  preview: LinkPreview;
}

export function LinkPreviewCard({ preview }: LinkPreviewCardProps) {
  const handleClick = () => {
    openUrl(preview.url).catch((err) => {
      console.error("Failed to open URL:", err);
    });
  };

  const domain = (() => {
    try {
      return new URL(preview.url).hostname.replace(/^www\./, "");
    } catch {
      return preview.url;
    }
  })();

  return (
    <button
      onClick={handleClick}
      className="mt-2 flex w-full max-w-md overflow-hidden rounded-lg border border-white/10 bg-discord-surface/50 text-left transition-colors hover:bg-discord-surface/70"
    >
      {preview.imageUrl && (
        <div className="flex w-20 shrink-0 items-center justify-center bg-discord-bg/50">
          <img
            src={preview.imageUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 p-2">
        {preview.siteName && (
          <span className="truncate text-xs text-white/50">{preview.siteName}</span>
        )}
        {preview.title && (
          <span className="line-clamp-1 text-sm font-medium text-white">{preview.title}</span>
        )}
        {preview.description && (
          <span className="line-clamp-2 text-xs text-white/60">{preview.description}</span>
        )}
        <span className="truncate text-xs text-white/40">{domain}</span>
      </div>
    </button>
  );
}
