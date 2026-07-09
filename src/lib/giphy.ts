/**
 * GIPHY API client — raw fetch, typed responses.
 *
 * Uses the GIPHY REST API v1 with a beta key (client-safe, Vite-embedded).
 * No SDK dependency. Content filtered to `rating: "pg"` for a messaging app.
 * Uses `bundle: "messaging_non_clips"` for optimized renditions.
 */

const GIPHY_BASE = "https://api.giphy.com/v1/gifs";

export interface GiphyImage {
  url: string;
  width: string;
  height: string;
}

export interface GiphyGif {
  id: string;
  title: string;
  alt_text: string;
  images: {
    fixed_height_small: GiphyImage;
    original: GiphyImage;
    downsized_medium?: GiphyImage;
  };
}

interface GiphyResponse {
  data: GiphyGif[];
  pagination: {
    total_count: number;
    count: number;
    offset: number;
  };
}

function getApiKey(): string {
  return import.meta.env.VITE_GIPHY_API_KEY ?? "";
}

export function hasGiphyKey(): boolean {
  return !!getApiKey();
}

/**
 * Search GIPHY for GIFs matching a query. Returns up to `limit` results.
 */
export async function searchGifs(query: string, limit = 24): Promise<GiphyGif[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  const params = new URLSearchParams({
    api_key: apiKey,
    q: query,
    limit: String(limit),
    rating: "pg",
    bundle: "messaging_non_clips",
    lang: "en",
  });

  const res = await fetch(`${GIPHY_BASE}/search?${params}`);
  if (!res.ok) return [];
  const json: GiphyResponse = await res.json();
  return json.data;
}

/**
 * Get trending GIFs from GIPHY. Returns up to `limit` results.
 */
export async function getTrendingGifs(limit = 24): Promise<GiphyGif[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  const params = new URLSearchParams({
    api_key: apiKey,
    limit: String(limit),
    rating: "pg",
    bundle: "messaging_non_clips",
  });

  const res = await fetch(`${GIPHY_BASE}/trending?${params}`);
  if (!res.ok) return [];
  const json: GiphyResponse = await res.json();
  return json.data;
}
