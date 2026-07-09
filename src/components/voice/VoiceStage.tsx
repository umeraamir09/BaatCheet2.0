/**
 * Phase 6 — Group voice stage (Decisions D6, D7, D8, D11).
 *
 * Fixed-width column (~w-72) rendered alongside LobbyThread when connected to
 * group voice (side-by-side layout — Decision D6). Shows the live participant
 * roster (D8) with speaking indicators (green ring) + mute icons, plus the
 * mute/deafen/leave controls bar (D7 — reuses Phase-4 iconography).
 *
 * The hidden audio container (audioContainerRef) hosts the <audio> elements
 * the hook attaches via track.attach() on RoomEvent.TrackSubscribed.
 */
import type { UseGroupVoiceResult, ParticipantInfo } from "../../hooks/useGroupVoice";

interface VoiceStageProps {
  groupVoice: UseGroupVoiceResult;
}

export function VoiceStage({ groupVoice }: VoiceStageProps) {
  const { participants, muted, deafened, connecting, connected, setMuted, setDeafened, leave, audioContainerRef } =
    groupVoice;

  return (
    <aside className="flex w-72 flex-col border-r border-white/8 bg-discord-surface">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-white/8 px-3 py-2.5">
        <SpeakerIcon />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">Lobby Voice</p>
          <p className="truncate text-xs text-white/60">
            {participants.length} connected
          </p>
        </div>
      </header>

      {/* Roster (D8) */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {connecting && !connected && (
          <p className="px-1 py-4 text-center text-xs text-white/50">
            Connecting to voice…
          </p>
        )}
        {connected && participants.length === 1 && (
          <p className="px-1 py-4 text-center text-xs text-white/50">
            You're the first one here
          </p>
        )}
        {connected &&
          participants.map((p) => (
            <ParticipantRow key={p.identity} participant={p} />
          ))}
      </div>

      {/* Controls bar (D7 — reuse Phase-4 iconography) */}
      <div className="flex items-center justify-center gap-2 border-t border-white/8 px-3 py-2.5">
        <button
          onClick={() => setMuted(!muted)}
          className={`rounded px-3 py-1.5 text-xs font-medium ${
            muted
              ? "bg-red-600 text-white hover:bg-red-700"
              : "bg-white/10 text-white hover:bg-white/20"
          }`}
          title={muted ? "Unmute" : "Mute"}
        >
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          onClick={() => setDeafened(!deafened)}
          className={`rounded px-3 py-1.5 text-xs font-medium ${
            deafened
              ? "bg-red-600 text-white hover:bg-red-700"
              : "bg-white/10 text-white hover:bg-white/20"
          }`}
          title={deafened ? "Undeafen" : "Deafen"}
        >
          {deafened ? "Undeafen" : "Deafen"}
        </button>
        <button
          onClick={() => void leave()}
          className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
          title="Leave voice"
        >
          Leave
        </button>
      </div>

      {/* Hidden audio container — the hook appends <audio> elements here on TrackSubscribed */}
      <div ref={audioContainerRef} className="hidden" />
    </aside>
  );
}

/** Single participant row in the roster. */
function ParticipantRow({ participant }: { participant: ParticipantInfo }) {
  const { name, avatarUrl, isLocal, isSpeaking, isMicEnabled } = participant;

  return (
    <div className="flex items-center gap-2 rounded px-2 py-1.5">
      {/* Avatar with speaking ring */}
      <div className={`relative h-8 w-8 flex-shrink-0 ${isSpeaking ? "ring-2 ring-green-500 rounded-full" : ""}`}>
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={`${name} avatar`}
            className="h-8 w-8 rounded-full"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-discord-blurple text-xs font-medium text-white">
            {name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Name + mute icon */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-white">
          {name}
          {isLocal && <span className="ml-1 text-xs text-white/40">(You)</span>}
        </p>
      </div>

      {/* Mute icon */}
      {!isMicEnabled && (
        <MutedMicIcon />
      )}
    </div>
  );
}

/** Speaker icon for the header. */
function SpeakerIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-white/60"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

/** Muted mic icon for the roster. */
function MutedMicIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-red-500"
    >
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}
