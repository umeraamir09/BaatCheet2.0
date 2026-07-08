/**
 * Phase 4 — Call lifecycle hook (Decisions D1, D3, D11).
 *
 * State machine: idle → initiating (caller) / ringing (callee) → connected → ended.
 *
 * Caller path: startCall(peerUserId) → getUserMedia → PeerCall.startCaller() →
 *   offerSdp → startCall mutation → callId → subscribe getCall(callId) → trickle ICE →
 *   on answerSdp → setRemoteDescription → on remote stream → connected.
 *
 * Callee path: subscribe listIncomingCalls(myUserId) → on incoming doc → ringing →
 *   accept → getUserMedia → PeerCall.startCallee(offerSdp) → answerSdp → answerCall →
 *   subscribe getCall → trickle ICE → on remote stream → connected.
 *   Decision D11 auto-reject: if status !== idle, auto-reject (no toast).
 *
 * leave(reason): endCall → PeerCall.close() → stop tracks → status ended.
 * Ring timeout (caller): 30s → markMissed.
 * Cleanup on unmount / logout / window close: leave if active.
 *
 * Mirrors usePresence/useDMThread patterns: "skip" gating, cleanedRef idempotency,
 * Promise.race teardown, cleanup keyed on callId.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { PeerCall } from "../webrtc/peerConnection";

export type CallStatus = "idle" | "initiating" | "ringing" | "connected" | "ended";

export interface UseCallResult {
  status: CallStatus;
  callId: Id<"calls"> | null;
  peerUserId: Id<"users"> | null;
  peerProfile: { displayName: string | null; username: string; avatarUrl: string } | null;
  muted: boolean;
  deafened: boolean;
  startCall: (peerUserId: Id<"users">, peerProfile: { displayName: string | null; username: string; avatarUrl: string }) => Promise<void>;
  accept: () => Promise<void>;
  reject: () => Promise<void>;
  leave: (reason?: string) => Promise<void>;
  setMuted: (muted: boolean) => void;
  setDeafened: (deafened: boolean) => void;
  /** Ref to the <audio> element for remote stream attachment. */
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  /** The incoming call doc (for the toast). null if no incoming call. */
  incomingCall: {
    _id: Id<"calls">;
    callerId: Id<"users">;
    caller: { displayName: string | null; username: string; avatarUrl: string } | null;
  } | null;
}

const RING_TIMEOUT_MS = 30_000;
const LEAVE_TIMEOUT_MS = 2_000;

/**
 * Call lifecycle hook.
 *
 * @param myUserId - the caller's Convex users._id (from usePresence)
 */
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

  const peerCallRef = useRef<PeerCall | null>(null);
  const cleanedRef = useRef(false);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const iceCandidatesSeenRef = useRef<Set<string>>(new Set());
  const callIdRef = useRef<Id<"calls"> | null>(null);

  // Mutations.
  const startCallMutation = useMutation(api.calls.startCall);
  const answerCallMutation = useMutation(api.calls.answerCall);
  const rejectCallMutation = useMutation(api.calls.rejectCall);
  const endCallMutation = useMutation(api.calls.endCall);
  const markMissedMutation = useMutation(api.calls.markMissed);
  const addIceCandidateMutation = useMutation(api.calls.addIceCandidate);

  // Keep callIdRef in sync with callId state
  useEffect(() => {
    callIdRef.current = callId;
  }, [callId]);

  // Reactive queries.
  const callDoc = useQuery(api.calls.getCall, callId ? { callId } : "skip");
  const incomingCallDoc = useQuery(
    api.calls.listIncomingCalls,
    myUserId ? { calleeId: myUserId } : "skip",
  );

  // Cleanup helper — declared early so it can be used in effects below.
  const cleanup = useCallback(() => {
    if (cleanedRef.current) return;
    cleanedRef.current = true;

    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    if (peerCallRef.current) {
      peerCallRef.current.close();
      peerCallRef.current = null;
    }
    iceCandidatesSeenRef.current.clear();
    callIdRef.current = null;
  }, []);

  // Leave / end the call — declared early so it can be used in callbacks below.
  const leave = useCallback(
    async (reason: string = "left") => {
      if (!callId) return;

      try {
        await Promise.race([
          endCallMutation({ callId, reason }),
          new Promise<void>((resolve) => setTimeout(resolve, LEAVE_TIMEOUT_MS)),
        ]);
      } catch (e) {
        console.error("endCall failed:", e);
      }

      setStatus("ended");
      cleanup();
    },
    [callId, endCallMutation, cleanup],
  );

  // Decision D11 auto-reject: if an incoming call arrives while status !== idle,
  // auto-reject immediately (no toast shown).
  useEffect(() => {
    if (incomingCallDoc && status !== "idle" && status !== "ringing") {
      rejectCallMutation({ callId: incomingCallDoc._id }).catch((e) =>
        console.error("auto-reject failed:", e),
      );
    }
  }, [incomingCallDoc, status, rejectCallMutation]);

  // Subscribe to the call doc for state transitions + ICE trickle.
  useEffect(() => {
    if (!callDoc || !peerCallRef.current) return;

    const pc = peerCallRef.current;

    // Caller: on answerSdp arriving (status → accepted), set remote description.
    if (callDoc.answerSdp && callDoc.status === "accepted") {
      pc.setRemoteAnswer(callDoc.answerSdp).catch((e) =>
        console.error("setRemoteAnswer failed:", e),
      );
    }

    // ICE trickle — dedup by candidate.candidate string.
    const isCaller = callDoc.callerId === myUserId;
    const remoteIceCandidates = isCaller
      ? callDoc.calleeIceCandidates
      : callDoc.callerIceCandidates;

    for (const candidateJson of remoteIceCandidates) {
      if (iceCandidatesSeenRef.current.has(candidateJson)) continue;
      iceCandidatesSeenRef.current.add(candidateJson);

      try {
        const candidate = JSON.parse(candidateJson) as RTCIceCandidateInit;
        pc.addRemoteIceCandidate(candidate).catch((e) =>
          console.error("addRemoteIceCandidate failed:", e),
        );
      } catch (e) {
        console.error("Failed to parse ICE candidate:", e);
      }
    }

    // Status transitions — derive from callDoc.
    if (callDoc.status === "accepted" && status !== "connected") {
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
      setStatus("ended");
      cleanup();
    }
  }, [callDoc, myUserId, status, cleanup]);

  // Start a call (caller path).
  const startCall = async (
    peerUserId: Id<"users">,
    peerProfile: { displayName: string | null; username: string; avatarUrl: string },
  ) => {
    if (!myUserId || status !== "idle") return;

    setStatus("initiating");
    setPeerUserId(peerUserId);
    setPeerProfile(peerProfile);
    cleanedRef.current = false;

    try {
      const pc = await PeerCall.create({
        onIceCandidate: (candidate) => {
          if (callIdRef.current) {
            addIceCandidateMutation({
              callId: callIdRef.current,
              side: "caller",
              candidate: JSON.stringify(candidate),
            }).catch((e) => console.error("addIceCandidate failed:", e));
          }
        },
        onRemoteStream: (stream) => {
          if (audioRef.current) {
            audioRef.current.srcObject = stream;
            audioRef.current.play().catch((e) => console.error("audio play failed:", e));
          }
        },
        onConnectionStateChange: (state) => {
          if (state === "failed" || state === "disconnected") {
            leave("error");
          }
        },
        onIceConnectionStateChange: () => {},
      });

      peerCallRef.current = pc;
      const offerSdp = await pc.startCaller();

      const newCallId = await startCallMutation({
        callerId: myUserId,
        calleeId: peerUserId,
        offerSdp,
      });

      callIdRef.current = newCallId;
      setCallId(newCallId);

      // Ring timeout — 30s → markMissed.
      ringTimeoutRef.current = setTimeout(() => {
        markMissedMutation({ callId: newCallId }).catch((e) =>
          console.error("markMissed failed:", e),
        );
        setStatus("ended");
        cleanup();
      }, RING_TIMEOUT_MS);
    } catch (e) {
      console.error("startCall failed:", e);
      setStatus("ended");
      cleanup();
    }
  };

  // Accept an incoming call (callee path).
  const accept = async () => {
    if (!myUserId || !incomingCallDoc || status !== "idle") return;

    setStatus("ringing");
    setPeerUserId(incomingCallDoc.callerId);
    setPeerProfile(incomingCallDoc.caller);
    cleanedRef.current = false;

    try {
      const pc = await PeerCall.create({
        onIceCandidate: (candidate) => {
          if (callIdRef.current) {
            addIceCandidateMutation({
              callId: callIdRef.current,
              side: "callee",
              candidate: JSON.stringify(candidate),
            }).catch((e) => console.error("addIceCandidate failed:", e));
          }
        },
        onRemoteStream: (stream) => {
          if (audioRef.current) {
            audioRef.current.srcObject = stream;
            audioRef.current.play().catch((e) => console.error("audio play failed:", e));
          }
        },
        onConnectionStateChange: (state) => {
          if (state === "failed" || state === "disconnected") {
            leave("error");
          }
        },
        onIceConnectionStateChange: () => {},
      });

      peerCallRef.current = pc;
      const answerSdp = await pc.startCallee(incomingCallDoc.offerSdp);

      await answerCallMutation({
        callId: incomingCallDoc._id,
        answerSdp,
      });

      callIdRef.current = incomingCallDoc._id;
      setCallId(incomingCallDoc._id);
    } catch (e) {
      console.error("accept failed:", e);
      setStatus("ended");
      cleanup();
    }
  };

  // Reject an incoming call.
  const reject = async () => {
    if (!incomingCallDoc) return;
    await rejectCallMutation({ callId: incomingCallDoc._id });
    setStatus("ended");
  };

  // Mute / deafen.
  const setMuted = (muted: boolean) => {
    setMutedState(muted);
    peerCallRef.current?.setMuted(muted);
  };

  const setDeafened = (deafened: boolean) => {
    setDeafenedState(deafened);
    peerCallRef.current?.setDeafened(deafened);
    if (audioRef.current) {
      audioRef.current.muted = deafened;
    }
  };

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (status !== "idle" && status !== "ended") {
        leave();
      }
    };
  }, [status, leave]);

  // Reset state when status becomes ended.
  useEffect(() => {
    if (status === "ended") {
      const timer = setTimeout(() => {
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
