/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL: string;
  readonly VITE_CONVEX_SITE_URL?: string;
  readonly VITE_DISCORD_CLIENT_ID: string;
  readonly VITE_ICE_SERVERS?: string; // JSON string of RTCIceServer[]
  readonly VITE_GIPHY_API_KEY?: string; // GIPHY beta key (client-safe)
  readonly VITE_LIVEKIT_URL?: string; // LiveKit server WebSocket URL (wss://...) — Phase 6 group voice
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
