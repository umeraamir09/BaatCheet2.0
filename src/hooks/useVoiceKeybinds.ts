import { useEffect } from "react";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import {
  type KeybindPreferences,
  eventToKeybind,
  formatGlobalShortcut,
  isEditableTarget,
  keybindsEqual,
} from "../lib/keybinds";

interface UseVoiceKeybindsArgs {
  preferences: KeybindPreferences;
  captureActive: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
}

export function useVoiceKeybinds({
  preferences,
  captureActive,
  onToggleMute,
  onToggleDeafen,
}: UseVoiceKeybindsArgs) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || captureActive || isEditableTarget(event.target)) return;
      const binding = eventToKeybind(event);
      if (!binding) return;

      if (
        preferences.toggleMute.enabled &&
        keybindsEqual(preferences.toggleMute.binding, binding)
      ) {
        event.preventDefault();
        onToggleMute();
        return;
      }

      if (
        preferences.toggleDeafen.enabled &&
        keybindsEqual(preferences.toggleDeafen.binding, binding)
      ) {
        event.preventDefault();
        onToggleDeafen();
      }
    };

    const attachFocusedListener = () => {
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    };

    const isTauri = Boolean(
      (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
    );

    const registrations = [
      {
        shortcut: preferences.toggleMute.enabled
          ? formatGlobalShortcut(preferences.toggleMute.binding)
          : null,
        onPressed: onToggleMute,
      },
      {
        shortcut: preferences.toggleDeafen.enabled
          ? formatGlobalShortcut(preferences.toggleDeafen.binding)
          : null,
        onPressed: onToggleDeafen,
      },
    ].filter(
      (registration): registration is { shortcut: string; onPressed: () => void } =>
        Boolean(registration.shortcut),
    );

    if (isTauri && !captureActive && registrations.length > 0) {
      let cancelled = false;
      let removeFocusedFallback: (() => void) | undefined;
      const shortcuts = registrations.map(({ shortcut }) => shortcut);
      const registration = Promise.all(
        registrations.map(({ shortcut, onPressed }) =>
          register(shortcut, (event) => {
            if (!cancelled && event.state === "Pressed") onPressed();
          }),
        ),
      );

      return () => {
        cancelled = true;
        removeFocusedFallback?.();
        void registration
          .then(() => unregister(shortcuts))
          .catch((error) => {
            if (!cancelled) {
              removeFocusedFallback = attachFocusedListener();
            }
            console.error(
              "Failed to register voice global shortcuts; falling back to focused-window shortcuts:",
              error,
            );
          });
      };
    }

    // Keep Vite/browser development usable; browser key events cannot be global.
    if (!isTauri) {
      return attachFocusedListener();
    }

    return undefined;
  }, [captureActive, onToggleDeafen, onToggleMute, preferences]);
}
