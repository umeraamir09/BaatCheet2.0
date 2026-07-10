import { useCallback, useEffect, useState } from "react";
import {
  type Keybind,
  type KeybindAction,
  type KeybindPreferences,
  DEFAULT_KEYBINDS,
  loadKeybindPreferences,
  saveKeybindPreferences,
} from "../lib/keybinds";

export function useKeybindPreferences() {
  const [preferences, setPreferences] = useState<KeybindPreferences>(() => {
    try {
      return loadKeybindPreferences();
    } catch {
      return DEFAULT_KEYBINDS;
    }
  });

  useEffect(() => {
    try {
      saveKeybindPreferences(preferences);
    } catch {
      // localStorage may be unavailable. Keybinds are a local preference.
    }
  }, [preferences]);

  const setBinding = useCallback((action: KeybindAction, binding: Keybind | null) => {
    setPreferences((prev) => ({
      ...prev,
      [action]: { ...prev[action], binding },
    }));
  }, []);

  const setEnabled = useCallback((action: KeybindAction, enabled: boolean) => {
    setPreferences((prev) => ({
      ...prev,
      [action]: { ...prev[action], enabled },
    }));
  }, []);

  const reset = useCallback(() => setPreferences(DEFAULT_KEYBINDS), []);

  return { preferences, setBinding, setEnabled, reset };
}
