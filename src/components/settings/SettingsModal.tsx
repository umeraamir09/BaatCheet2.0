import { KeyboardEvent, useState } from "react";
import { Check, RotateCcw, Settings, Trash2, X } from "lucide-react";
import {
  type Keybind,
  type KeybindAction,
  type KeybindPreferences,
  eventToKeybind,
  findDuplicateAction,
  formatKeybind,
  isReservedKeybind,
} from "../../lib/keybinds";
import type { UpdateStatus } from "../../lib/updater";
import { IconButton } from "../ui/IconButton";

interface SettingsModalProps {
  open: boolean;
  keybinds: KeybindPreferences;
  updateStatus: UpdateStatus;
  onClose: () => void;
  onSetBinding: (action: KeybindAction, binding: Keybind | null) => void;
  onSetEnabled: (action: KeybindAction, enabled: boolean) => void;
  onResetKeybinds: () => void;
  onCaptureChange: (capturing: boolean) => void;
  onCheckForUpdates: () => void;
}

const ACTION_LABELS: Record<KeybindAction, { label: string; description: string }> = {
  toggleMute: {
    label: "Toggle Mute",
    description: "Toggle your microphone's transmission on and off.",
  },
  toggleDeafen: {
    label: "Toggle Deafen",
    description: "Mute incoming voice and your microphone together.",
  },
};

export function SettingsModal({
  open,
  keybinds,
  updateStatus,
  onClose,
  onSetBinding,
  onSetEnabled,
  onResetKeybinds,
  onCaptureChange,
  onCheckForUpdates,
}: SettingsModalProps) {
  const [editing, setEditing] = useState<KeybindAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const startEditing = (action: KeybindAction) => {
    setError(null);
    setEditing(action);
    onCaptureChange(true);
  };

  const stopEditing = () => {
    setEditing(null);
    onCaptureChange(false);
  };

  const capture = (action: KeybindAction, event: KeyboardEvent<HTMLButtonElement>) => {
    if (editing !== action) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      stopEditing();
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      onSetBinding(action, null);
      stopEditing();
      return;
    }

    const binding = eventToKeybind(event.nativeEvent);
    if (!binding) return;

    if (isReservedKeybind(binding)) {
      setError(`${formatKeybind(binding)} is reserved by the app or operating system.`);
      return;
    }

    const duplicate = findDuplicateAction(keybinds, action, binding);
    if (duplicate) {
      setError(`${formatKeybind(binding)} is already used by ${ACTION_LABELS[duplicate].label}.`);
      return;
    }

    onSetBinding(action, binding);
    setError(null);
    stopEditing();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-6">
      <section className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-discord-border bg-discord-elevated shadow-2xl">
        <header className="flex items-center gap-3 border-b border-discord-border px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-discord-control text-discord-muted">
            <Settings size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-discord-text">Settings</h2>
            <p className="text-sm text-discord-muted">Voice shortcuts and local update checks.</p>
          </div>
          <IconButton label="Close settings" variant="ghost" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </header>

        <div className="overflow-y-auto p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-discord-text">Keybinds</h3>
              <p className="text-sm text-discord-muted">
                Global shortcuts for the active 1:1 or group voice session, even when BaatCheet is
                in the background.
              </p>
            </div>
            <button
              type="button"
              onClick={onResetKeybinds}
              className="inline-flex items-center gap-2 rounded-lg bg-discord-control px-3 py-2 text-sm font-medium text-discord-text hover:bg-discord-control-hover"
            >
              <RotateCcw size={15} />
              Reset
            </button>
          </div>

          <div className="space-y-3">
            {(Object.keys(ACTION_LABELS) as KeybindAction[]).map((action) => (
              <KeybindRow
                key={action}
                action={action}
                setting={keybinds[action]}
                editing={editing === action}
                onEdit={() => startEditing(action)}
                onCapture={(event) => capture(action, event)}
                onClear={() => onSetBinding(action, null)}
                onEnabledChange={(enabled) => onSetEnabled(action, enabled)}
              />
            ))}
          </div>

          {error && (
            <p className="mt-3 rounded-lg border border-discord-danger/40 bg-discord-danger/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}

          <div className="mt-6 rounded-xl border border-discord-border bg-discord-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-discord-text">Updater test path</h3>
                <p className="text-sm text-discord-muted">
                  Checks the configured local/static Tauri updater endpoint.
                </p>
              </div>
              <button
                type="button"
                onClick={onCheckForUpdates}
                disabled={updateStatus.state === "checking" || updateStatus.state === "downloading"}
                className="rounded-lg bg-discord-blurple px-3 py-2 text-sm font-semibold text-white hover:bg-discord-blurple-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                Check update
              </button>
            </div>
            <p className="mt-3 text-sm text-discord-muted">{updateStatus.message}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function KeybindRow({
  action,
  setting,
  editing,
  onEdit,
  onCapture,
  onClear,
  onEnabledChange,
}: {
  action: KeybindAction;
  setting: KeybindPreferences[KeybindAction];
  editing: boolean;
  onEdit: () => void;
  onCapture: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onClear: () => void;
  onEnabledChange: (enabled: boolean) => void;
}) {
  const meta = ACTION_LABELS[action];
  return (
    <div className="grid grid-cols-[1.2fr_1fr_auto_auto] items-start gap-4 rounded-xl border border-discord-border bg-discord-bg p-4">
      <div>
        <p className="font-medium text-discord-text">{meta.label}</p>
        <p className="mt-1 text-xs text-discord-muted">{meta.description}</p>
      </div>

      <button
        type="button"
        onClick={editing ? undefined : onEdit}
        onKeyDown={onCapture}
        className={`flex min-h-12 items-center justify-between rounded-lg border px-3 text-left text-sm ${
          editing
            ? "border-discord-focus bg-discord-control text-discord-text"
            : "border-discord-border bg-discord-surface text-discord-text hover:bg-discord-control"
        }`}
      >
        <span>{editing ? "Press keys..." : formatKeybind(setting.binding)}</span>
        {editing ? <Check size={16} /> : <span className="text-xs text-discord-muted">Edit</span>}
      </button>

      <IconButton label={`Clear ${meta.label}`} variant="ghost" onClick={onClear}>
        <Trash2 size={17} />
      </IconButton>

      <label className="flex h-10 items-center gap-2">
        <input
          type="checkbox"
          checked={setting.enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
          className="sr-only"
        />
        <span
          className={`relative h-7 w-12 rounded-full transition-colors ${
            setting.enabled ? "bg-discord-blurple" : "bg-discord-control"
          }`}
        >
          <span
            className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-transform ${
              setting.enabled ? "translate-x-5" : ""
            }`}
          />
        </span>
        <span className="sr-only">
          {setting.enabled ? "Disable" : "Enable"} {meta.label}
        </span>
      </label>
    </div>
  );
}
