/**
 * GifPicker — GIPHY-powered GIF search and selection.
 *
 * Shows trending GIFs by default, with a search bar for finding specific GIFs.
 * Uses raw fetch calls to the GIPHY API (no SDK dependency).
 * When a GIF is selected, it's sent as a message attachment.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { searchGifs, getTrendingGifs, hasGiphyKey, type GiphyGif } from "../../lib/giphy";

interface GifPickerProps {
  onSelect: (gif: { url: string; width: number; height: number; alt: string }) => void;
  onClose: () => void;
}

export function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<GiphyGif[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Load trending GIFs on mount
  useEffect(() => {
    if (!hasGiphyKey()) return;
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
    getTrendingGifs(24)
      .then(setGifs)
      .catch((err) => console.error("Failed to load trending GIFs:", err))
      .finally(() => setLoading(false));
  }, []);

  // Debounced search
  const handleSearch = useCallback((value: string) => {
    setQuery(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!value.trim()) {
      // Clear search — reload trending
      searchTimeoutRef.current = setTimeout(() => {
        if (!hasGiphyKey()) return;
        setLoading(true);
        getTrendingGifs(24)
          .then(setGifs)
          .catch((err) => console.error("Failed to load trending GIFs:", err))
          .finally(() => setLoading(false));
      }, 300);
      return;
    }

    // Search for GIFs
    searchTimeoutRef.current = setTimeout(() => {
      if (!hasGiphyKey()) return;
      setLoading(true);
      searchGifs(value, 24)
        .then(setGifs)
        .catch((err) => console.error("Failed to search GIFs:", err))
        .finally(() => setLoading(false));
    }, 300);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const handleGifClick = (gif: GiphyGif) => {
    const image = gif.images.downsized_medium ?? gif.images.original;
    onSelect({
      url: image.url,
      width: parseInt(image.width, 10),
      height: parseInt(image.height, 10),
      alt: gif.alt_text || gif.title || "GIF",
    });
  };

  if (!hasGiphyKey()) {
    return (
      <div
        ref={containerRef}
        className="absolute bottom-full left-0 z-50 mb-2 w-80 rounded-lg border border-white/10 bg-discord-surface p-4"
      >
        <p className="text-sm text-white/60">
          GIPHY API key not configured. Add{" "}
          <code className="rounded bg-discord-bg px-1">VITE_GIPHY_API_KEY</code> to your .env file.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 z-50 mb-2 flex w-80 flex-col rounded-lg border border-white/10 bg-discord-surface"
    >
      {/* Search bar */}
      <div className="border-b border-white/10 p-2">
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search GIFs..."
          className="w-full rounded bg-discord-bg px-3 py-1.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-discord-blurple"
          autoFocus
        />
      </div>

      {/* GIF grid */}
      <div className="h-80 overflow-y-auto p-2">
        {loading && gifs.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-white/40">Loading...</p>
          </div>
        ) : gifs.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-white/40">No GIFs found</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {gifs.map((gif) => (
              <button
                key={gif.id}
                onClick={() => handleGifClick(gif)}
                className="group relative aspect-video overflow-hidden rounded transition-transform hover:scale-105"
              >
                <img
                  src={gif.images.fixed_height_small.url}
                  alt={gif.alt_text || gif.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Attribution */}
      <div className="border-t border-white/10 px-2 py-1">
        <p className="text-center text-xs text-white/40">
          Powered by <span className="font-medium">GIPHY</span>
        </p>
      </div>
    </div>
  );
}
