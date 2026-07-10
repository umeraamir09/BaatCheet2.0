/**
 * Phase 6 — Group voice hook (Decisions D2-deviated, D4, D5, D7, D9, D11, D12).
 *
 * State machine: disconnected → connecting → connected → disconnected.
 *
 * Owns the LiveKit `Room` instance in a ref (mirrors `useCall` owning `PeerCall`).
 * Drives the participant roster from `RoomEvent` listeners (not a provider context).
 * Audio tracks attached manually via `track.attach()` on `RoomEvent.TrackSubscribed`
 * (confirmed necessary from livekit-client readme — audio rendering is manual).
 *
 * join(): mint token via Convex action → create Room → register event handlers →
 *   room.connect() → setMicrophoneEnabled(true) → connected.
 * leave(): room.disconnect() (triggers TrackUnsubscribed → detach all audio) →
 *   stop local tracks → cleanup.
 *
 * Mute/deafen (D7 — Discord semantics):
 *   mute = localParticipant.setMicrophoneEnabled(false)
 *   deafen = mute mic + mute all attached <audio> elements (remote playback)
 *
 * Teardown on unmount: leave() if connected (same pattern as useCall unmount effect).
 *
 * Mutual exclusivity with 1:1 call (D9) is NOT enforced here — the layout composes
 * it via wrapper callbacks (keeps hooks decoupled, no circular deps).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import {
  Room,
  RoomEvent,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
} from "livekit-client";
import { playJoinSound, playLeaveSound, unlockAudio } from "../lib/soundEffects";

const LOG_PREFIX = "[useGroupVoice]";

export type GroupVoiceStatus = "disconnected" | "connecting" | "connected";

export interface ParticipantInfo {
  identity: string;
  name: string;
  avatarUrl: string;
  displayName: string | null;
  username: string;
  isLocal: boolean;
  isSpeaking: boolean;
  isMicEnabled: boolean;
}

export interface UseGroupVoiceResult {
  status: GroupVoiceStatus;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  muted: boolean;
  deafened: boolean;
  participants: ParticipantInfo[];
  join: () => Promise<void>;
  leave: () => Promise<void>;
  setMuted: (muted: boolean) => void;
  setDeafened: (deafened: boolean) => void;
  audioContainerRef: React.MutableRefObject<HTMLDivElement | null>;
}

const LEAVE_TIMEOUT_MS = 2_000;

/** Parse participant metadata JSON (set in the token by mintToken). */
function parseMetadata(metadata: string | undefined): {
  avatarUrl: string;
  displayName: string | null;
  username: string;
} {
  if (!metadata) return { avatarUrl: "", displayName: null, username: "" };
  try {
    const parsed = JSON.parse(metadata);
    return {
      avatarUrl: parsed.avatarUrl ?? "",
      displayName: parsed.displayName ?? null,
      username: parsed.username ?? "",
    };
  } catch {
    return { avatarUrl: "", displayName: null, username: "" };
  }
}

export function useGroupVoice(myUserId: Id<"users"> | null): UseGroupVoiceResult {
  const [status, setStatus] = useState<GroupVoiceStatus>("disconnected");
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  const [muted, setMutedState] = useState(false);
  const [deafened, setDeafenedState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());

  const roomRef = useRef<Room | null>(null);
  const statusRef = useRef<GroupVoiceStatus>("disconnected");
  const cleanedRef = useRef(false);
  const audioElementsRef = useRef<HTMLMediaElement[]>([]);
  const audioContainerRef = useRef<HTMLDivElement | null>(null);

  const mintTokenAction = useAction(api.livekit.mintToken);
  const announceJoin = useMutation(api.voicePresence.join);
  const announceLeave = useMutation(api.voicePresence.leave);

  // Keep statusRef in sync.
  useEffect(() => {
    console.log(`${LOG_PREFIX} Status transition: ${statusRef.current} → ${status}`);
    statusRef.current = status;
  }, [status]);

  /** Rebuild the participants array from room state. */
  const refreshParticipants = useCallback((room: Room, speaking: Set<string>) => {
    const list: ParticipantInfo[] = [];
    // Local participant first.
    const lp = room.localParticipant;
    if (lp) {
      const meta = parseMetadata(lp.metadata);
      list.push({
        identity: lp.identity,
        name: lp.name ?? meta.displayName ?? meta.username ?? "You",
        avatarUrl: meta.avatarUrl,
        displayName: meta.displayName,
        username: meta.username,
        isLocal: true,
        isSpeaking: speaking.has(lp.identity),
        isMicEnabled: lp.isMicrophoneEnabled,
      });
    }
    // Remote participants.
    room.remoteParticipants.forEach((rp: RemoteParticipant) => {
      const meta = parseMetadata(rp.metadata);
      list.push({
        identity: rp.identity,
        name: rp.name ?? meta.displayName ?? meta.username ?? rp.identity,
        avatarUrl: meta.avatarUrl,
        displayName: meta.displayName,
        username: meta.username,
        isLocal: false,
        isSpeaking: speaking.has(rp.identity),
        isMicEnabled: rp.isMicrophoneEnabled,
      });
    });
    setParticipants(list);
  }, []);

  /** Register event handlers on the room. */
  const registerEvents = useCallback(
    (room: Room) => {
      room
        .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
          console.log(`${LOG_PREFIX} Participant connected: ${p.identity}`);
          playJoinSound();
          refreshParticipants(room, speakingIds);
        })
        .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
          console.log(`${LOG_PREFIX} Participant disconnected: ${p.identity}`);
          playLeaveSound();
          refreshParticipants(room, speakingIds);
        })
        .on(RoomEvent.ParticipantMetadataChanged, (_prev: string | undefined, p: Participant) => {
          console.log(`${LOG_PREFIX} Participant metadata changed: ${p.identity}`);
          refreshParticipants(room, speakingIds);
        })
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          console.log(`${LOG_PREFIX} Track subscribed: ${track.kind}`);
          if (track.kind === "audio") {
            const el = track.attach();
            el.autoplay = true;
            audioElementsRef.current.push(el);
            audioContainerRef.current?.appendChild(el);
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          console.log(`${LOG_PREFIX} Track unsubscribed: ${track.kind}`);
          const detached = track.detach();
          detached.forEach((el) => {
            const idx = audioElementsRef.current.indexOf(el);
            if (idx >= 0) audioElementsRef.current.splice(idx, 1);
          });
        })
        .on(RoomEvent.TrackMuted, () => {
          refreshParticipants(room, speakingIds);
        })
        .on(RoomEvent.TrackUnmuted, () => {
          refreshParticipants(room, speakingIds);
        })
        .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
          const ids = new Set(speakers.map((s) => s.identity));
          setSpeakingIds(ids);
          refreshParticipants(room, ids);
        })
        .on(RoomEvent.Disconnected, () => {
          console.log(`${LOG_PREFIX} Disconnected from room`);
          if (!cleanedRef.current) {
            setStatus("disconnected");
            setParticipants([]);
            setMutedState(false);
            setDeafenedState(false);
            setError(null);
          }
        })
        .on(RoomEvent.AudioPlaybackStatusChanged, () => {
          if (!room.canPlaybackAudio) {
            console.log(`${LOG_PREFIX} Audio playback blocked, attempting startAudio`);
            room.startAudio().catch((e) => console.error(`${LOG_PREFIX} startAudio failed:`, e));
          }
        });
    },
    [refreshParticipants, speakingIds],
  );

  /** Cleanup: detach all audio, remove event listeners, reset state. */
  const cleanup = useCallback(() => {
    if (cleanedRef.current) return;
    cleanedRef.current = true;
    console.log(`${LOG_PREFIX} Running cleanup`);

    // Detach all audio elements.
    audioElementsRef.current.forEach((el) => {
      el.remove();
    });
    audioElementsRef.current = [];

    if (roomRef.current) {
      roomRef.current.removeAllListeners();
      roomRef.current = null;
    }
  }, []);

  /** Leave the voice room (D5 — one-click). */
  const leave = useCallback(async () => {
    const room = roomRef.current;
    if (!room) {
      console.log(`${LOG_PREFIX} leave() called but no room, ignoring`);
      return;
    }
    console.log(`${LOG_PREFIX} leave() called`);

    playLeaveSound();

    try {
      await Promise.race([
        room.disconnect(true),
        new Promise<void>((resolve) => setTimeout(resolve, LEAVE_TIMEOUT_MS)),
      ]);
      console.log(`${LOG_PREFIX} room.disconnect() succeeded`);
    } catch (e) {
      console.error(`${LOG_PREFIX} room.disconnect() failed:`, e);
    }

    setStatus("disconnected");
    setParticipants([]);
    setMutedState(false);
    setDeafenedState(false);
    setError(null);
    cleanup();
    if (myUserId) void announceLeave({ userId: myUserId });
  }, [cleanup, announceLeave, myUserId]);

  /** Join the voice room (D5 — single-click). */
  const join = useCallback(async () => {
    if (!myUserId) {
      console.log(`${LOG_PREFIX} join blocked: no myUserId`);
      return;
    }
    if (status === "connecting" || status === "connected") {
      console.log(`${LOG_PREFIX} join blocked: status=${status}`);
      return;
    }

    const livekitUrl = import.meta.env.VITE_LIVEKIT_URL;
    if (!livekitUrl) {
      console.error(`${LOG_PREFIX} join failed: VITE_LIVEKIT_URL not set`);
      setError("LiveKit server not configured (VITE_LIVEKIT_URL missing)");
      return;
    }

    console.log(`${LOG_PREFIX} join initiated`);
    setStatus("connecting");
    setError(null);
    cleanedRef.current = false;

    // Unlock audio context during the user gesture so subsequent sounds can play.
    await unlockAudio();

    try {
      // Mint token via Convex action.
      console.log(`${LOG_PREFIX} Minting token...`);
      const { token } = await mintTokenAction({ userId: myUserId });
      console.log(`${LOG_PREFIX} Token minted, length=${token.length}`);

      // Create room.
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      roomRef.current = room;

      // Register event handlers.
      registerEvents(room);

      // Connect.
      console.log(`${LOG_PREFIX} Connecting to ${livekitUrl}...`);
      await room.connect(livekitUrl, token);
      console.log(`${LOG_PREFIX} Connected to room`);

      // Enable mic.
      console.log(`${LOG_PREFIX} Enabling microphone...`);
      await room.localParticipant.setMicrophoneEnabled(true);
      console.log(`${LOG_PREFIX} Microphone enabled`);

      // Attempt to start audio playback (user gesture from join click should suffice).
      if (!room.canPlaybackAudio) {
        await room.startAudio();
      }

      // Initial participants refresh.
      refreshParticipants(room, speakingIds);

      // Self-join sound: local voice joins should also get feedback.
      playJoinSound();

      setStatus("connected");
      await announceJoin({ userId: myUserId });
    } catch (e) {
      console.error(`${LOG_PREFIX} join failed:`, e);
      setError(e instanceof Error ? e.message : "Failed to join voice");
      setStatus("disconnected");
      cleanup();
    }
  }, [
    myUserId,
    status,
    mintTokenAction,
    announceJoin,
    registerEvents,
    refreshParticipants,
    speakingIds,
    cleanup,
  ]);

  /** Mute/unmute (D7 — Discord semantics). */
  const setMuted = useCallback(
    (m: boolean) => {
      const room = roomRef.current;
      if (!room) return;
      console.log(`${LOG_PREFIX} setMuted: ${m}`);
      room.localParticipant
        .setMicrophoneEnabled(!m)
        .catch((e) => console.error(`${LOG_PREFIX} setMicrophoneEnabled failed:`, e));
      setMutedState(m);
      // Refresh participants to update the local mute icon.
      refreshParticipants(room, speakingIds);
    },
    [refreshParticipants, speakingIds],
  );

  /** Deafen/undeafen (D7 — Discord semantics: can't hear AND can't talk). */
  const setDeafened = useCallback(
    (d: boolean) => {
      const room = roomRef.current;
      if (!room) return;
      console.log(`${LOG_PREFIX} setDeafened: ${d}`);
      // Mute mic (same as mute).
      room.localParticipant
        .setMicrophoneEnabled(!d)
        .catch((e) => console.error(`${LOG_PREFIX} setMicrophoneEnabled (deafen) failed:`, e));
      // Mute all attached <audio> elements (remote playback).
      audioElementsRef.current.forEach((el) => {
        el.muted = d;
      });
      setDeafenedState(d);
      setMutedState(d);
      refreshParticipants(room, speakingIds);
    },
    [refreshParticipants, speakingIds],
  );

  /** Teardown on unmount (D12 — mirrors useCall unmount effect). */
  useEffect(() => {
    console.log(`${LOG_PREFIX} [UNMOUNT-EFFECT] Registered`);
    return () => {
      console.log(
        `${LOG_PREFIX} [UNMOUNT-EFFECT] Cleanup firing, current status=${statusRef.current}`,
      );
      if (statusRef.current === "connected") {
        void leave();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    connected: status === "connected",
    connecting: status === "connecting",
    error,
    muted,
    deafened,
    participants,
    join,
    leave,
    setMuted,
    setDeafened,
    audioContainerRef,
  };
}
