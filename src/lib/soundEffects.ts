/**
 * Tiny join/leave sound-effect player for voice calls (Phase 4/6).
 *
 * Uses Web Audio API when available, with HTMLAudioElement fallback for WebViews
 * that keep AudioContext suspended after async call setup.
 */

let audioContext: AudioContext | null = null;
let joinBuffer: AudioBuffer | null = null;
let leaveBuffer: AudioBuffer | null = null;
let joinAudio: HTMLAudioElement | null = null;
let leaveAudio: HTMLAudioElement | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

function getFallbackAudio(url: string): HTMLAudioElement {
  const isJoin = url.includes("join");
  const existing = isJoin ? joinAudio : leaveAudio;
  if (existing) {
    return existing;
  }

  const audio = new Audio(url);
  audio.preload = "auto";
  audio.volume = 0.65;

  if (isJoin) {
    joinAudio = audio;
  } else {
    leaveAudio = audio;
  }

  return audio;
}

async function loadBuffer(url: string): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return ctx.decodeAudioData(arrayBuffer);
}

function playFallbackAudio(url: string): void {
  const audio = getFallbackAudio(url);
  audio.currentTime = 0;
  audio.play().catch((e) => console.error("Sound effect playback failed:", e));
}

async function playBuffer(buffer: AudioBuffer | null, url: string): Promise<void> {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  if (!buffer) {
    try {
      const loaded = await loadBuffer(url);
      if (url.includes("join")) {
        joinBuffer = loaded;
      } else {
        leaveBuffer = loaded;
      }
      await playBuffer(loaded, url);
    } catch (e) {
      console.error("Sound effect load failed:", e);
      playFallbackAudio(url);
    }
    return;
  }

  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  gain.gain.value = 0.65;
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start();
}

/** Unlock playback during a user gesture and start warming both public audio files. */
export async function unlockAudio(): Promise<void> {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch (e) {
      console.error("Audio unlock failed:", e);
    }
  }

  getFallbackAudio("/vc-join.mp3").load();
  getFallbackAudio("/vc-leave.mp3").load();

  if (!joinBuffer) {
    loadBuffer("/vc-join.mp3")
      .then((b) => (joinBuffer = b))
      .catch((e) => console.error("Join sound preload failed:", e));
  }
  if (!leaveBuffer) {
    loadBuffer("/vc-leave.mp3")
      .then((b) => (leaveBuffer = b))
      .catch((e) => console.error("Leave sound preload failed:", e));
  }
}

export function playJoinSound(): void {
  playBuffer(joinBuffer, "/vc-join.mp3").catch((e) => {
    console.error("Join sound playback failed:", e);
    playFallbackAudio("/vc-join.mp3");
  });
}

export function playLeaveSound(): void {
  playBuffer(leaveBuffer, "/vc-leave.mp3").catch((e) => {
    console.error("Leave sound playback failed:", e);
    playFallbackAudio("/vc-leave.mp3");
  });
}
