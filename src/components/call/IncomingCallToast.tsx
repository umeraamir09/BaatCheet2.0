/**
 * Phase 4 — Incoming call toast (Decision D6, D12).
 *
 * Bottom-right fixed-position toast; caller avatar + display name + "is calling
 * you…" + Accept / Decline buttons. Auto-hide when the call doc transitions out
 * of "calling" (accepted/rejected/missed/ended). Reuses discord-surface + blurple
 * tokens. No ring tone (mission: pared-down; silent toast for v1).
 */

interface IncomingCallToastProps {
  caller: { displayName: string | null; username: string; avatarUrl: string } | null;
  onAccept: () => void;
  onDecline: () => void;
}

export function IncomingCallToast({
  caller,
  onAccept,
  onDecline,
}: IncomingCallToastProps) {
  const name = caller?.displayName ?? caller?.username ?? "Someone";

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg bg-discord-surface px-4 py-3 shadow-lg">
      {caller?.avatarUrl && (
        <img
          src={caller.avatarUrl}
          alt={`${name} avatar`}
          className="h-10 w-10 rounded-full"
        />
      )}
      <div className="flex flex-col">
        <p className="text-sm font-medium text-white">{name}</p>
        <p className="text-xs text-white/60">is calling you…</p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onAccept}
          className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
        >
          Accept
        </button>
        <button
          onClick={onDecline}
          className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
