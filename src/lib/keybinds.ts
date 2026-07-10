export type KeybindAction = "toggleMute" | "toggleDeafen";

export interface Keybind {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface KeybindSetting {
  enabled: boolean;
  binding: Keybind | null;
}

export type KeybindPreferences = Record<KeybindAction, KeybindSetting>;

export const KEYBIND_STORAGE_KEY = "baatcheet.keybinds.v1";

export const DEFAULT_KEYBINDS: KeybindPreferences = {
  toggleMute: {
    enabled: true,
    binding: {
      key: "M",
      code: "KeyM",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    },
  },
  toggleDeafen: {
    enabled: true,
    binding: {
      key: "D",
      code: "KeyD",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    },
  },
};

const RESERVED_KEYS = new Set([
  "Ctrl+R",
  "Ctrl+Shift+R",
  "Ctrl+W",
  "Ctrl+T",
  "Ctrl+N",
  "Ctrl+L",
  "Ctrl+Shift+I",
  "F5",
]);

export function normalizeKey(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  if (key === " ") return "Space";
  if (key === "Esc") return "Escape";
  return key;
}

export function eventToKeybind(
  event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">,
): Keybind | null {
  const key = normalizeKey(event.key);
  if (["Control", "Shift", "Alt", "Meta", "Escape"].includes(key)) return null;
  return {
    key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  };
}

export function formatKeybind(binding: Keybind | null): string {
  if (!binding) return "Not set";
  const parts: string[] = [];
  if (binding.ctrlKey) parts.push("Ctrl");
  if (binding.shiftKey) parts.push("Shift");
  if (binding.altKey) parts.push("Alt");
  if (binding.metaKey) parts.push("Meta");
  parts.push(binding.key);
  return parts.join("+");
}

/** Convert the user-facing keybind shape into Tauri's global shortcut syntax. */
export function formatGlobalShortcut(binding: Keybind | null): string | null {
  if (!binding) return null;
  const parts: string[] = [];
  if (binding.ctrlKey) parts.push("CommandOrControl");
  if (binding.shiftKey) parts.push("Shift");
  if (binding.altKey) parts.push("Alt");
  if (binding.metaKey) parts.push("Super");

  const key = binding.code.startsWith("Key")
    ? binding.code.slice(3)
    : binding.code.startsWith("Digit")
      ? binding.code.slice(5)
      : binding.key;
  parts.push(key === " " ? "Space" : key);
  return parts.join("+");
}

export function keybindsEqual(a: Keybind | null, b: Keybind | null): boolean {
  if (!a || !b) return false;
  return (
    a.code === b.code &&
    a.ctrlKey === b.ctrlKey &&
    a.shiftKey === b.shiftKey &&
    a.altKey === b.altKey &&
    a.metaKey === b.metaKey
  );
}

export function isReservedKeybind(binding: Keybind): boolean {
  return RESERVED_KEYS.has(formatKeybind(binding));
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

export function loadKeybindPreferences(): KeybindPreferences {
  try {
    const raw = localStorage.getItem(KEYBIND_STORAGE_KEY);
    if (!raw) return DEFAULT_KEYBINDS;
    const parsed = JSON.parse(raw) as Partial<KeybindPreferences>;
    return {
      toggleMute: { ...DEFAULT_KEYBINDS.toggleMute, ...parsed.toggleMute },
      toggleDeafen: { ...DEFAULT_KEYBINDS.toggleDeafen, ...parsed.toggleDeafen },
    };
  } catch {
    return DEFAULT_KEYBINDS;
  }
}

export function saveKeybindPreferences(preferences: KeybindPreferences) {
  localStorage.setItem(KEYBIND_STORAGE_KEY, JSON.stringify(preferences));
}

export function findDuplicateAction(
  preferences: KeybindPreferences,
  action: KeybindAction,
  binding: Keybind,
): KeybindAction | null {
  for (const [candidateAction, setting] of Object.entries(preferences) as [
    KeybindAction,
    KeybindSetting,
  ][]) {
    if (candidateAction !== action && keybindsEqual(setting.binding, binding)) {
      return candidateAction;
    }
  }
  return null;
}
