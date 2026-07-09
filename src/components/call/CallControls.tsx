/**
 * Phase 4 — In-call controls (Decision D12).
 *
 * Floating bar rendered in AuthenticatedLayout over the main pane, independent
 * of the active DM. User can browse DMs mid-call. Hosts the hidden <audio>
 * element whose srcObject the hook sets on onRemoteStream.
 *
 * Controls: mute toggle, deafen toggle, leave button, live mm:ss timer, peer
 * avatar + name, "Connected" / "Connecting…" state. Reuses discord-surface +
 * blurple + green-500 tokens.
 */
import { useEffect, useRef, useState } from "react";
import type { CallStatus } from "../../hooks/useCall";

interface CallControlsProps {
  status: CallStatus;
  peerProfile: { displayName: string | null; username: string; avatarUrl: string } | null;
  muted: boolean;
  deafened: boolean;
  onMute: (muted: boolean) => void;
  onDeafen: (deafened: boolean) => void;
  onLeave: () => void;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
}

export function CallControls({
  status,
  peerProfile,
  muted,
  deafened,
  onMute,
  onDeafen,
  onLeave,
  audioRef,
}: CallControlsProps) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStatusRef = useRef<CallStatus>(status);

  // Timer — starts when connected, stops when not. Reset elapsed on status change.
  useEffect(() => {
    // Reset elapsed when status changes away from connected.
    if (prevStatusRef.current === "connected" && status !== "connected") {
      setElapsed(0);
    }
    prevStatusRef.current = status;

    if (status === "connected") {
      intervalRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [status]);

  const peerName = peerProfile?.displayName ?? peerProfile?.username ?? "Unknown";
  const statusText = status === "connected" ? "Connected" : "Connecting…";
  const statusColor = status === "connected" ? "text-green-500" : "text-white/60";

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg bg-discord-surface px-4 py-3 shadow-lg">
      <div className="flex items-center gap-4">
        {/* Peer info */}
        {peerProfile?.avatarUrl && (
          <img
            src={peerProfile.avatarUrl}
            alt={`${peerName} avatar`}
            className="h-10 w-10 rounded-full"
          />
        )}
        <div className="flex flex-col">
          <p className="text-sm font-medium text-white">{peerName}</p>
          <p className={`text-xs ${statusColor}`}>
            {status === "connected" ? formatTime(elapsed) : statusText}
          </p>
        </div>

        {/* Controls */}
        <div className="flex gap-2">
          <button
            onClick={() => onMute(!muted)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              muted
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-white/10 text-white hover:bg-white/20"
            }`}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? "Unmute" : "Mute"}
          </button>
          <button
            onClick={() => onDeafen(!deafened)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              deafened
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-white/10 text-white hover:bg-white/20"
            }`}
            title={deafened ? "Undeafen" : "Deafen"}
          >
            {deafened ? "Undeafen" : "Deafen"}
          </button>
          <button
            onClick={onLeave}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            Leave
          </button>
        </div>
      </div>

      {/* Hidden <audio> element for remote stream */}
      <audio ref={audioRef} autoPlay className="hidden" />
    </div>
  );
}
