import { HeadphoneOff, Headphones, Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import type { UseGroupVoiceResult, ParticipantInfo } from "../../hooks/useGroupVoice";
import { IconButton } from "../ui/IconButton";

interface VoiceStageProps {
  groupVoice: UseGroupVoiceResult;
}

export function VoiceStage({ groupVoice }: VoiceStageProps) {
  const {
    participants,
    muted,
    deafened,
    connecting,
    connected,
    setMuted,
    setDeafened,
    leave,
    audioContainerRef,
  } = groupVoice;

  return (
    <aside className="flex w-80 flex-col border-r border-discord-border bg-discord-sidebar">
      <header className="flex items-center gap-3 border-b border-discord-border px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-discord-control text-discord-muted">
          <Volume2 size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-discord-text">Lobby Voice</p>
          <p className="truncate text-xs text-discord-muted">{participants.length} connected</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {connecting && !connected && (
          <p className="px-1 py-4 text-center text-xs text-discord-muted">Connecting to voice...</p>
        )}
        {connected && participants.length === 1 && (
          <p className="px-1 py-4 text-center text-xs text-discord-muted">
            You're the first one here
          </p>
        )}
        {connected && participants.map((p) => <ParticipantRow key={p.identity} participant={p} />)}
      </div>

      <div className="flex items-center justify-center gap-2 border-t border-discord-border px-3 py-3">
        <IconButton
          label={muted ? "Unmute" : "Mute"}
          variant={muted ? "danger" : "default"}
          onClick={() => setMuted(!muted)}
        >
          {muted ? <MicOff size={18} /> : <Mic size={18} />}
        </IconButton>
        <IconButton
          label={deafened ? "Undeafen" : "Deafen"}
          variant={deafened ? "danger" : "default"}
          onClick={() => setDeafened(!deafened)}
        >
          {deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
        </IconButton>
        <IconButton label="Leave voice" variant="danger" onClick={() => void leave()}>
          <PhoneOff size={18} />
        </IconButton>
      </div>

      <div ref={audioContainerRef} className="hidden" />
    </aside>
  );
}

function ParticipantRow({ participant }: { participant: ParticipantInfo }) {
  const { name, avatarUrl, isLocal, isSpeaking, isMicEnabled } = participant;

  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-discord-control">
      <div
        className={`relative h-9 w-9 flex-shrink-0 rounded-full ${
          isSpeaking ? "ring-2 ring-discord-success ring-offset-2 ring-offset-discord-sidebar" : ""
        }`}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt={`${name} avatar`} className="h-9 w-9 rounded-full" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-discord-blurple text-xs font-medium text-white">
            {name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-discord-text">
          {name}
          {isLocal && <span className="ml-1 text-xs text-discord-subtle">(You)</span>}
        </p>
      </div>

      {!isMicEnabled && <MicOff size={15} className="text-discord-danger" />}
    </div>
  );
}
