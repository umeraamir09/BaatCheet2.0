import {
  Headphones,
  HeadphoneOff,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PhoneOff,
} from "lucide-react";
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
  peerMuted: boolean;
  peerDeafened: boolean;
  localSpeaking: boolean;
  remoteSpeaking: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onMute: (muted: boolean) => void;
  onDeafen: (deafened: boolean) => void;
  onLeave: () => void;
}

export function CallControls({
  status,
  localProfile,
  peerProfile,
  muted,
  deafened,
  peerMuted,
  peerDeafened,
  localSpeaking,
  remoteSpeaking,
  fullscreen,
  onToggleFullscreen,
  onMute,
  onDeafen,
  onLeave,
}: CallControlsProps) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const peerName = peerProfile?.displayName ?? peerProfile?.username ?? "Unknown";

  useEffect(() => {
    if (status !== "connected") return;
    intervalRef.current = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [status]);

  const content = (
    <>
      <div className={`flex items-center justify-center ${fullscreen ? "flex-1 gap-10" : "gap-4"}`}>
        <Participant
          profile={peerProfile}
          label={peerName}
          speaking={remoteSpeaking}
          muted={peerMuted}
          deafened={peerDeafened}
          large={fullscreen}
        />
        <Participant
          profile={localProfile}
          label={localProfile.displayName ?? localProfile.username}
          speaking={localSpeaking}
          muted={muted}
          deafened={deafened}
          large={fullscreen}
        />
      </div>
      <div className={fullscreen ? "text-center" : "min-w-0 flex-1"}>
        <p className="truncate font-semibold text-discord-text">{peerName}</p>
        <p className="text-sm text-discord-muted">
          {status === "connected" ? formatTime(elapsed) : "Connecting…"}
        </p>
      </div>
      <div className="flex items-center justify-center gap-2">
        <IconButton
          label={muted ? "Unmute" : "Mute"}
          variant={muted ? "danger" : "default"}
          onClick={() => onMute(!muted)}
        >
          {muted ? <MicOff size={18} /> : <Mic size={18} />}
        </IconButton>
        <IconButton
          label={deafened ? "Undeafen" : "Deafen"}
          variant={deafened ? "danger" : "default"}
          onClick={() => onDeafen(!deafened)}
        >
          {deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
        </IconButton>
        <IconButton
          label={fullscreen ? "Exit full screen" : "Full screen"}
          variant="default"
          onClick={onToggleFullscreen}
        >
          {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </IconButton>
        <IconButton label="Leave call" variant="danger" onClick={onLeave}>
          <PhoneOff size={18} />
        </IconButton>
      </div>
    </>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black/95 p-8 text-discord-text">
        {content}
      </div>
    );
  }
  return (
    <section className="flex items-center gap-4 border-b border-discord-border bg-discord-surface px-4 py-3">
      {content}
    </section>
  );
}

function Participant({
  profile,
  label,
  speaking,
  muted,
  deafened,
  large,
}: {
  profile: Profile | null;
  label: string;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
  large: boolean;
}) {
  const size = large ? "h-28 w-28" : "h-12 w-12";
  return (
    <div className="relative shrink-0">
      <div
        className={`rounded-full border-4 bg-discord-surface p-1 transition-colors ${speaking ? "border-discord-success" : "border-discord-border"}`}
      >
        {profile?.avatarUrl ? (
          <img src={profile.avatarUrl} alt={`${label} avatar`} className={`${size} rounded-full`} />
        ) : (
          <div
            className={`${size} flex items-center justify-center rounded-full bg-discord-blurple text-lg font-semibold text-white`}
          >
            {label.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      {(muted || deafened) && (
        <span
          className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-discord-danger text-white"
          title={deafened ? "Deafened" : "Muted"}
        >
          {deafened ? <HeadphoneOff size={13} /> : <MicOff size={13} />}
        </span>
      )}
    </div>
  );
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}
