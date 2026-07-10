/**
 * Phase 4 — Call lifecycle hook (Decisions D1, D3, D11).
 *
 * State machine: idle → initiating (caller) / ringing (callee) → connected → ended.
 *
 * Caller path: startCall(peerUserId) → create call doc → set callIdRef →
 *   getUserMedia → PeerCall.startCaller() → offerSdp → update call doc →
 *   subscribe getCall(callId) → trickle ICE (buffered until callId set) →
 *   on answerSdp → setRemoteDescription → on remote stream → connected.
 *
 * Callee path: subscribe listIncomingCalls(myUserId) → on incoming doc →
 *   set callIdRef → getUserMedia → PeerCall.startCallee(offerSdp) → answerSdp →
 *   answerCall → subscribe getCall → trickle ICE → on remote stream → connected.
 *   Decision D11 auto-reject: if status !== idle, auto-reject (no toast).
 *
 * leave(reason): endCall → PeerCall.close() → stop tracks → status ended.
 * Ring timeout (caller): 30s → markMissed.
 * Cleanup on unmount / logout / window close: leave if active.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { PeerCall } from "../webrtc/peerConnection";
import { playJoinSound, playLeaveSound, unlockAudio } from "../lib/soundEffects";

const LOG_PREFIX = "[useCall]";

export type CallStatus = "idle" | "initiating" | "ringing" | "connected" | "ended";

export interface UseCallResult {
  status: CallStatus;
  callId: Id<"calls"> | null;
  peerUserId: Id<"users"> | null;
  peerProfile: { displayName: string | null; username: string; avatarUrl: string } | null;
  muted: boolean;
  deafened: boolean;
  peerMuted: boolean;
  peerDeafened: boolean;
  localSpeaking: boolean;
  remoteSpeaking: boolean;
  startCall: (
    peerUserId: Id<"users">,
    peerProfile: { displayName: string | null; username: string; avatarUrl: string },
  ) => Promise<void>;
  accept: () => Promise<void>;
  reject: () => Promise<void>;
  leave: (reason?: string) => Promise<void>;
  setMuted: (muted: boolean) => void;
  setDeafened: (deafened: boolean) => void;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  incomingCall: {
    _id: Id<"calls">;
    callerId: Id<"users">;
    caller: { displayName: string | null; username: string; avatarUrl: string } | null;
  } | null;
}

const RING_TIMEOUT_MS = 30_000;
const LEAVE_TIMEOUT_MS = 2_000;

export function useCall(myUserId: Id<"users"> | null): UseCallResult {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [callId, setCallId] = useState<Id<"calls"> | null>(null);
  const [peerUserId, setPeerUserId] = useState<Id<"users"> | null>(null);
  const [peerProfile, setPeerProfile] = useState<{
    displayName: string | null;
    username: string;
    avatarUrl: string;
  } | null>(null);
  const [muted, setMutedState] = useState(false);
  const [deafened, setDeafenedState] = useState(false);
  const [peerMuted, setPeerMuted] = useState(false);
  const [peerDeafened, setPeerDeafened] = useState(false);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [remoteSpeaking, setRemoteSpeaking] = useState(false);

  const peerCallRef = useRef<PeerCall | null>(null);
  const cleanedRef = useRef(false);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const iceCandidatesSeenRef = useRef<Set<string>>(new Set());
  const callIdRef = useRef<Id<"calls"> | null>(null);
  const pendingCandidatesRef = useRef<{ side: string; json: string }[]>([]);
  const answerAppliedRef = useRef(false);
  const statusRef = useRef<CallStatus>("idle");
  const stopSpeakingRefs = useRef<(() => void)[]>([]);

  // Keep statusRef in sync with status state
  useEffect(() => {
    console.log(`${LOG_PREFIX} Status transition: ${statusRef.current} → ${status}`);
    statusRef.current = status;
  }, [status]);

  // Mutations.
  const startCallMutation = useMutation(api.calls.startCall);
  const answerCallMutation = useMutation(api.calls.answerCall);
  const rejectCallMutation = useMutation(api.calls.rejectCall);
  const endCallMutation = useMutation(api.calls.endCall);
  const markMissedMutation = useMutation(api.calls.markMissed);
  const addIceCandidateMutation = useMutation(api.calls.addIceCandidate);
  const updateMediaStateMutation = useMutation(api.calls.updateMediaState);

  // Reactive queries.
  const callDoc = useQuery(api.calls.getCall, callId ? { callId } : "skip");
  const incomingCallDoc = useQuery(
    api.calls.listIncomingCalls,
    myUserId ? { calleeId: myUserId } : "skip",
  );

  // Flush buffered ICE candidates once callId is available.
  const flushPendingCandidates = useCallback(() => {
    if (!callIdRef.current || pendingCandidatesRef.current.length === 0) return;
    console.log(
      `${LOG_PREFIX} Flushing ${pendingCandidatesRef.current.length} buffered ICE candidates`,
    );
    for (const { side, json } of pendingCandidatesRef.current) {
      addIceCandidateMutation({
        callId: callIdRef.current,
        side,
        candidate: json,
      }).catch((e) => console.error(`${LOG_PREFIX} flush addIceCandidate failed:`, e));
    }
    pendingCandidatesRef.current = [];
  }, [addIceCandidateMutation]);

  // Buffer or send an ICE candidate.
  const sendIceCandidate = useCallback(
    (side: string, candidate: RTCIceCandidateInit) => {
      const json = JSON.stringify(candidate);
      if (callIdRef.current) {
        console.log(`${LOG_PREFIX} Sending ICE candidate (${side}) immediately`);
        addIceCandidateMutation({
          callId: callIdRef.current,
          side,
          candidate: json,
        }).catch((e) => console.error(`${LOG_PREFIX} addIceCandidate failed:`, e));
      } else {
        console.log(`${LOG_PREFIX} Buffering ICE candidate (${side}), callId not yet set`);
        pendingCandidatesRef.current.push({ side, json });
      }
    },
    [addIceCandidateMutation],
  );

  // Cleanup helper.
  const cleanup = useCallback(() => {
    if (cleanedRef.current) {
      console.log(`${LOG_PREFIX} Cleanup already ran, skipping`);
      return;
    }
    cleanedRef.current = true;
    console.log(`${LOG_PREFIX} Running cleanup`);

    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    if (peerCallRef.current) {
      peerCallRef.current.close();
      peerCallRef.current = null;
    }
    iceCandidatesSeenRef.current.clear();
    pendingCandidatesRef.current = [];
    answerAppliedRef.current = false;
    callIdRef.current = null;
    stopSpeakingRefs.current.forEach((stop) => stop());
    stopSpeakingRefs.current = [];
    setLocalSpeaking(false);
    setRemoteSpeaking(false);
    setPeerMuted(false);
    setPeerDeafened(false);
  }, []);

  // Leave / end the call.
  const leave = useCallback(
    async (reason: string = "left") => {
      const id = callIdRef.current;
      if (!id) {
        console.log(`${LOG_PREFIX} leave() called but no callId, ignoring`);
        return;
      }
      console.log(`${LOG_PREFIX} leave() called with reason: ${reason}, callId: ${id}`);

      if (statusRef.current === "connected") {
        playLeaveSound();
      }

      try {
        await Promise.race([
          endCallMutation({ callId: id, reason }),
          new Promise<void>((resolve) => setTimeout(resolve, LEAVE_TIMEOUT_MS)),
        ]);
        console.log(`${LOG_PREFIX} endCall mutation succeeded`);
      } catch (e) {
        console.error(`${LOG_PREFIX} endCall failed:`, e);
      }

      setStatus("ended");
      cleanup();
    },
    [endCallMutation, cleanup],
  );

  // Decision D11 auto-reject: if an incoming call arrives while already in a call,
  // auto-reject immediately (no toast shown).
  useEffect(() => {
    if (incomingCallDoc && status !== "idle" && status !== "ringing") {
      console.log(
        `${LOG_PREFIX} Auto-rejecting incoming call ${incomingCallDoc._id} (status: ${status})`,
      );
      rejectCallMutation({ callId: incomingCallDoc._id }).catch((e) =>
        console.error(`${LOG_PREFIX} auto-reject failed:`, e),
      );
    }
  }, [incomingCallDoc, status, rejectCallMutation]);

  // Subscribe to the call doc for state transitions + ICE trickle.
  useEffect(() => {
    if (!callDoc || !peerCallRef.current) {
      if (callDoc) {
        console.log(`${LOG_PREFIX} callDoc updated but peerCallRef is null, skipping effect`);
      }
      return;
    }

    const pc = peerCallRef.current;
    const isCaller = callDoc.callerId === myUserId;

    setPeerMuted(isCaller ? (callDoc.calleeMuted ?? false) : (callDoc.callerMuted ?? false));
    setPeerDeafened(
      isCaller ? (callDoc.calleeDeafened ?? false) : (callDoc.callerDeafened ?? false),
    );

    console.log(`${LOG_PREFIX} callDoc effect: status=${callDoc.status}, isCaller=${isCaller}`);

    // ONLY the caller applies the remote answer. The callee already set the
    // remote offer in startCallee — applying the answer would throw.
    if (
      isCaller &&
      !answerAppliedRef.current &&
      callDoc.answerSdp &&
      callDoc.status === "accepted"
    ) {
      console.log(`${LOG_PREFIX} Applying remote answer (caller)`);
      answerAppliedRef.current = true;
      pc.setRemoteAnswer(callDoc.answerSdp).catch((e) =>
        console.error(`${LOG_PREFIX} setRemoteAnswer failed:`, e),
      );
    }

    // ICE trickle — dedup by candidate string.
    const remoteIceCandidates = isCaller
      ? callDoc.calleeIceCandidates
      : callDoc.callerIceCandidates;

    for (const candidateJson of remoteIceCandidates) {
      if (iceCandidatesSeenRef.current.has(candidateJson)) continue;
      iceCandidatesSeenRef.current.add(candidateJson);
      console.log(
        `${LOG_PREFIX} Processing remote ICE candidate (${isCaller ? "callee" : "caller"})`,
      );

      try {
        const candidate = JSON.parse(candidateJson) as RTCIceCandidateInit;
        pc.addRemoteIceCandidate(candidate).catch((e) =>
          console.error(`${LOG_PREFIX} addRemoteIceCandidate failed:`, e),
        );
      } catch (e) {
        console.error(`${LOG_PREFIX} Failed to parse ICE candidate:`, e);
      }
    }

    // Status transitions.
    if (callDoc.status === "accepted" && status !== "connected") {
      console.log(`${LOG_PREFIX} Call accepted, transitioning to connected`);
      playJoinSound();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("connected");
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = null;
      }
    } else if (
      callDoc.status === "ended" ||
      callDoc.status === "rejected" ||
      callDoc.status === "missed"
    ) {
      const wasConnected = statusRef.current === "connected";
      console.log(
        `${LOG_PREFIX} Call ended/rejected/missed, transitioning to ended (wasConnected=${wasConnected})`,
      );
      if (wasConnected) {
        playLeaveSound();
      }
      setStatus("ended");
      cleanup();
    }
  }, [callDoc, myUserId, status, cleanup]);

  // Start a call (caller path).
  const startCall = async (
    peerUserId: Id<"users">,
    peerProfile: { displayName: string | null; username: string; avatarUrl: string },
  ) => {
    if (!myUserId || status !== "idle") {
      console.log(`${LOG_PREFIX} startCall blocked: myUserId=${myUserId}, status=${status}`);
      return;
    }

    console.log(`${LOG_PREFIX} startCall initiated with peer:`, peerUserId);
    setStatus("initiating");
    setPeerUserId(peerUserId);
    setPeerProfile(peerProfile);
    cleanedRef.current = false;

    // Unlock audio context during the user gesture so subsequent sounds can play.
    await unlockAudio();
    answerAppliedRef.current = false;

    try {
      // Create the call doc FIRST so callIdRef is set before ICE candidates arrive.
      // We use a placeholder offerSdp; the real one is set after createOffer.
      console.log(`${LOG_PREFIX} Creating PeerCall (getUserMedia)...`);
      const pc = await PeerCall.create({
        onIceCandidate: (candidate) => sendIceCandidate("caller", candidate),
        onRemoteStream: (stream) => {
          console.log(`${LOG_PREFIX} Remote stream received (caller), attaching to audio element`);
          if (audioRef.current) {
            audioRef.current.srcObject = stream;
            audioRef.current
              .play()
              .catch((e) => console.error(`${LOG_PREFIX} audio play failed:`, e));
          }
          stopSpeakingRefs.current.push(watchSpeaking(stream, setRemoteSpeaking));
        },
        onConnectionStateChange: (state) => {
          console.log(`${LOG_PREFIX} Caller connection state:`, state);
          // Only leave on "failed" — "disconnected" is transient during ICE negotiation.
          if (state === "failed") {
            console.log(`${LOG_PREFIX} Connection failed, calling leave("error")`);
            leave("error");
          }
        },
        onIceConnectionStateChange: (state) => {
          console.log(`${LOG_PREFIX} Caller ICE connection state:`, state);
        },
      });

      peerCallRef.current = pc;
      if (pc.getLocalStream()) {
        stopSpeakingRefs.current.push(watchSpeaking(pc.getLocalStream()!, setLocalSpeaking));
      }
      console.log(`${LOG_PREFIX} PeerCall created, creating offer...`);
      const offerSdp = await pc.startCaller();
      console.log(`${LOG_PREFIX} Offer created, calling startCall mutation...`);

      const newCallId = await startCallMutation({
        callerId: myUserId,
        calleeId: peerUserId,
        offerSdp,
      });
      console.log(`${LOG_PREFIX} startCall mutation succeeded, callId:`, newCallId);

      callIdRef.current = newCallId;
      setCallId(newCallId);

      // Flush any ICE candidates that arrived during offer creation.
      flushPendingCandidates();

      // Ring timeout — 30s → markMissed.
      console.log(`${LOG_PREFIX} Setting 30s ring timeout`);
      ringTimeoutRef.current = setTimeout(() => {
        console.log(`${LOG_PREFIX} Ring timeout fired, calling markMissed`);
        markMissedMutation({ callId: newCallId }).catch((e) =>
          console.error(`${LOG_PREFIX} markMissed failed:`, e),
        );
        setStatus("ended");
        cleanup();
      }, RING_TIMEOUT_MS);
    } catch (e) {
      console.error(`${LOG_PREFIX} startCall failed:`, e);
      setStatus("ended");
      cleanup();
    }
  };

  // Accept an incoming call (callee path).
  const accept = async () => {
    if (!myUserId || !incomingCallDoc || status !== "idle") {
      console.log(
        `${LOG_PREFIX} accept blocked: myUserId=${myUserId}, incomingCallDoc=${!!incomingCallDoc}, status=${status}`,
      );
      return;
    }

    console.log(`${LOG_PREFIX} accept initiated, callId:`, incomingCallDoc._id);
    setStatus("ringing");
    setPeerUserId(incomingCallDoc.callerId);
    setPeerProfile(incomingCallDoc.caller);
    cleanedRef.current = false;
    answerAppliedRef.current = false;

    // Unlock audio context during the user gesture so subsequent sounds can play.
    await unlockAudio();

    // Set callIdRef BEFORE creating the answer so ICE candidates are buffered/sent.
    callIdRef.current = incomingCallDoc._id;
    setCallId(incomingCallDoc._id);

    try {
      console.log(`${LOG_PREFIX} Creating PeerCall for callee (getUserMedia)...`);
      const pc = await PeerCall.create({
        onIceCandidate: (candidate) => sendIceCandidate("callee", candidate),
        onRemoteStream: (stream) => {
          console.log(`${LOG_PREFIX} Remote stream received (callee), attaching to audio element`);
          if (audioRef.current) {
            audioRef.current.srcObject = stream;
            audioRef.current
              .play()
              .catch((e) => console.error(`${LOG_PREFIX} audio play failed:`, e));
          }
          stopSpeakingRefs.current.push(watchSpeaking(stream, setRemoteSpeaking));
        },
        onConnectionStateChange: (state) => {
          console.log(`${LOG_PREFIX} Callee connection state:`, state);
          if (state === "failed") {
            console.log(`${LOG_PREFIX} Connection failed, calling leave("error")`);
            leave("error");
          }
        },
        onIceConnectionStateChange: (state) => {
          console.log(`${LOG_PREFIX} Callee ICE connection state:`, state);
        },
      });

      peerCallRef.current = pc;
      if (pc.getLocalStream()) {
        stopSpeakingRefs.current.push(watchSpeaking(pc.getLocalStream()!, setLocalSpeaking));
      }
      console.log(`${LOG_PREFIX} PeerCall created, creating answer...`);
      const answerSdp = await pc.startCallee(incomingCallDoc.offerSdp);
      console.log(`${LOG_PREFIX} Answer created, calling answerCall mutation...`);

      await answerCallMutation({
        callId: incomingCallDoc._id,
        answerSdp,
      });
      console.log(`${LOG_PREFIX} answerCall mutation succeeded`);

      // Flush any ICE candidates that arrived during answer creation.
      flushPendingCandidates();
    } catch (e) {
      console.error(`${LOG_PREFIX} accept failed:`, e);
      callIdRef.current = null;
      setCallId(null);
      setStatus("ended");
      cleanup();
    }
  };

  // Reject an incoming call.
  const reject = async () => {
    if (!incomingCallDoc) return;
    console.log(`${LOG_PREFIX} reject called, callId:`, incomingCallDoc._id);
    await rejectCallMutation({ callId: incomingCallDoc._id });
    setStatus("ended");
  };

  // Mute / deafen.
  const setMuted = (muted: boolean) => {
    setMutedState(muted);
    peerCallRef.current?.setMuted(muted);
    if (callIdRef.current && myUserId) {
      updateMediaStateMutation({
        callId: callIdRef.current,
        userId: myUserId,
        muted,
        deafened,
      }).catch((e) => console.error(`${LOG_PREFIX} update media state failed:`, e));
    }
  };

  const setDeafened = (deafened: boolean) => {
    setDeafenedState(deafened);
    peerCallRef.current?.setDeafened(deafened);
    if (audioRef.current) {
      audioRef.current.muted = deafened;
    }
    const nextMuted = deafened ? true : false;
    setMutedState(nextMuted);
    if (callIdRef.current && myUserId) {
      updateMediaStateMutation({
        callId: callIdRef.current,
        userId: myUserId,
        muted: nextMuted,
        deafened,
      }).catch((e) => console.error(`${LOG_PREFIX} update media state failed:`, e));
    }
  };

  // Cleanup on unmount — only fires on actual component unmount, not on status changes.
  // Uses statusRef to check current status at cleanup time (not captured in closure).
  useEffect(() => {
    console.log(
      `${LOG_PREFIX} [UNMOUNT-EFFECT] Registered (will only run cleanup on actual unmount)`,
    );
    return () => {
      console.log(
        `${LOG_PREFIX} [UNMOUNT-EFFECT] Cleanup firing (actual unmount), current status=${statusRef.current}`,
      );
      if (statusRef.current !== "idle" && statusRef.current !== "ended") {
        console.log(
          `${LOG_PREFIX} [UNMOUNT-EFFECT] Status is ${statusRef.current}, calling leave()`,
        );
        leave();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset state when status becomes ended.
  useEffect(() => {
    if (status === "ended") {
      console.log(`${LOG_PREFIX} Status is ended, scheduling reset to idle in 500ms`);
      const timer = setTimeout(() => {
        console.log(`${LOG_PREFIX} Resetting state to idle`);
        setStatus("idle");
        setCallId(null);
        setPeerUserId(null);
        setPeerProfile(null);
        setMutedState(false);
        setDeafenedState(false);
        cleanedRef.current = false;
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [status]);

  return {
    status,
    callId,
    peerUserId,
    peerProfile,
    muted,
    deafened,
    peerMuted,
    peerDeafened,
    localSpeaking,
    remoteSpeaking,
    startCall,
    accept,
    reject,
    leave,
    setMuted,
    setDeafened,
    audioRef,
    incomingCall: incomingCallDoc && status === "idle" ? incomingCallDoc : null,
  };
}

/** Lightweight local-only audio activity monitor for speaking rings. */
function watchSpeaking(stream: MediaStream, setSpeaking: (speaking: boolean) => void): () => void {
  const AudioContextCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return () => {};

  const context = new AudioContextCtor();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  const source = context.createMediaStreamSource(stream);
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  let frame = 0;
  let stopped = false;
  let wasSpeaking = false;
  let lastSpeechAt = 0;

  const tick = () => {
    if (stopped) return;
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += Math.abs(sample - 128);
    const active = sum / samples.length > 2.5;
    if (active) lastSpeechAt = performance.now();
    const speaking = active || performance.now() - lastSpeechAt < 240;
    if (speaking !== wasSpeaking) {
      wasSpeaking = speaking;
      setSpeaking(speaking);
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    setSpeaking(false);
    source.disconnect();
    void context.close();
  };
}
