import { Mic, MicOff, Headphones, HeadphoneOff, PhoneOff, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CallStatus } from "../../hooks/useCall";
import { IconButton } from "../ui/IconButton";

interface Profile {
  displayName: string | null;
  username: string;
  avatarUrl: string;
}

interface CallControlsProps {
  status: CallStatus;
  localProfile: Profile;
  peerProfile: Profile | null;
  muted: boolean;
  deafened: boolean;
  onMute: (muted: boolean) => void;
  onDeafen: (deafened: boolean) => void;
  onLeave: () => void;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
}

export function CallControls({
  status,
  localProfile,
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

  useEffect(() => {
    if (prevStatusRef.current === "connected" && status !== "connected") {
      setElapsed(0);
    }
    prevStatusRef.current = status;

    if (status === "connected") {
      intervalRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [status]);

  const peerName = peerProfile?.displayName ?? peerProfile?.username ?? "Unknown";
  const statusText = status === "connected" ? formatTime(elapsed) : "Connecting...";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 text-discord-text">
      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <div className="flex items-center justify-center">
          <Avatar profile={peerProfile} label={peerName} large dimmed={status !== "connected"} />
          <Avatar
            profile={localProfile}
            label={localProfile.displayName ?? localProfile.username}
            large
          />
        </div>
        <div className="text-center">
          <p className="text-xl font-semibold">{peerName}</p>
          <p className="mt-1 text-sm text-discord-muted">{statusText}</p>
        </div>
      </div>

      <div className="flex justify-center pb-8">
        <div className="flex items-center gap-3 rounded-2xl border border-discord-border bg-discord-elevated/95 px-4 py-3 shadow-2xl">
          <IconButton
            label={muted ? "Unmute" : "Mute"}
            variant={muted ? "danger" : "default"}
            onClick={() => onMute(!muted)}
          >
            {muted ? <MicOff size={20} /> : <Mic size={20} />}
          </IconButton>
          <IconButton
            label={deafened ? "Undeafen" : "Deafen"}
            variant={deafened ? "danger" : "default"}
            onClick={() => onDeafen(!deafened)}
          >
            {deafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
          </IconButton>
          <IconButton label="More call options" variant="default">
            <MoreHorizontal size={20} />
          </IconButton>
          <IconButton label="Leave call" variant="danger" size="lg" onClick={onLeave}>
            <PhoneOff size={22} />
          </IconButton>
        </div>
      </div>

      <audio ref={audioRef} autoPlay className="hidden" />
    </div>
  );
}

function Avatar({
  profile,
  label,
  large = false,
  dimmed = false,
}: {
  profile: Profile | null;
  label: string;
  large?: boolean;
  dimmed?: boolean;
}) {
  const size = large ? "h-24 w-24" : "h-10 w-10";
  return (
    <div
      className={`-ml-3 first:ml-0 rounded-full border-4 border-black bg-discord-surface p-1 ${
        dimmed ? "opacity-60 grayscale" : ""
      }`}
    >
      {profile?.avatarUrl ? (
        <img src={profile.avatarUrl} alt={`${label} avatar`} className={`${size} rounded-full`} />
      ) : (
        <div
          className={`${size} flex items-center justify-center rounded-full bg-discord-blurple text-2xl font-semibold text-white`}
        >
          {label.charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}
