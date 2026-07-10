import { useEffect, useRef, useState } from "react";
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

export interface VoiceShortcutStatus {
  state: "active" | "registering" | "fallback" | "disabled";
  message: string;
}

/**
 * Registers native shortcuts only when the effective binding changes. Voice
 * callbacks are held in refs so routine React renders/call state updates never
 * unregister a working OS-level shortcut.
 */
export function useVoiceKeybinds({
  preferences,
  captureActive,
  onToggleMute,
  onToggleDeafen,
}: UseVoiceKeybindsArgs): VoiceShortcutStatus {
  const [status, setStatus] = useState<VoiceShortcutStatus>({
    state: "disabled",
    message: "Voice shortcuts are disabled.",
  });
  const preferencesRef = useRef(preferences);
  const captureRef = useRef(captureActive);
  const muteHandlerRef = useRef(onToggleMute);
  const deafenHandlerRef = useRef(onToggleDeafen);
  const isTauri = Boolean(
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  );
  const muteShortcut = preferences.toggleMute.enabled
    ? formatGlobalShortcut(preferences.toggleMute.binding)
    : null;
  const deafenShortcut = preferences.toggleDeafen.enabled
    ? formatGlobalShortcut(preferences.toggleDeafen.binding)
    : null;

  useEffect(() => {
    preferencesRef.current = preferences;
    captureRef.current = captureActive;
    muteHandlerRef.current = onToggleMute;
    deafenHandlerRef.current = onToggleDeafen;
  }, [captureActive, onToggleDeafen, onToggleMute, preferences]);

  const dispatchFocused = (event: KeyboardEvent) => {
    if (event.repeat || captureRef.current || isEditableTarget(event.target)) return;
    const binding = eventToKeybind(event);
    if (!binding) return;
    const current = preferencesRef.current;
    if (current.toggleMute.enabled && keybindsEqual(current.toggleMute.binding, binding)) {
      event.preventDefault();
      muteHandlerRef.current();
    } else if (
      current.toggleDeafen.enabled &&
      keybindsEqual(current.toggleDeafen.binding, binding)
    ) {
      event.preventDefault();
      deafenHandlerRef.current();
    }
  };

  const [nativeFailed, setNativeFailed] = useState(false);
  const deferStatus = (next: VoiceShortcutStatus) => queueMicrotask(() => setStatus(next));
  const deferNativeFailed = (failed: boolean) => queueMicrotask(() => setNativeFailed(failed));
  const effectGenRef = useRef(0);
  useEffect(() => {
    if (isTauri && !nativeFailed) return;
    window.addEventListener("keydown", dispatchFocused);
    return () => window.removeEventListener("keydown", dispatchFocused);
  }, [isTauri, nativeFailed]);

  useEffect(() => {
    const registrations = [
      muteShortcut ? { shortcut: muteShortcut, handler: () => muteHandlerRef.current() } : null,
      deafenShortcut
        ? { shortcut: deafenShortcut, handler: () => deafenHandlerRef.current() }
        : null,
    ].filter((entry): entry is { shortcut: string; handler: () => void } => entry !== null);

    if (!isTauri) {
      deferStatus({
        state: "fallback",
        message: "Focused-window shortcuts in browser development.",
      });
      return;
    }
    if (registrations.length === 0) {
      deferNativeFailed(false);
      deferStatus({ state: "disabled", message: "Voice shortcuts are disabled." });
      return;
    }

    const gen = ++effectGenRef.current;
    const registered: string[] = [];
    deferNativeFailed(false);
    deferStatus({ state: "registering", message: "Registering native voice shortcuts…" });
    void (async () => {
      try {
        for (const registration of registrations) {
          if (gen !== effectGenRef.current) return;
          await register(registration.shortcut, (event) => {
            if (!captureRef.current && event.state === "Pressed") registration.handler();
          });
          registered.push(registration.shortcut);
        }
        if (gen === effectGenRef.current) {
          deferStatus({
            state: "active",
            message: "Native shortcuts work while BaatCheet is in the background.",
          });
        }
      } catch (error) {
        await Promise.all(registered.map((shortcut) => unregister(shortcut).catch(() => {})));
        if (gen === effectGenRef.current) {
          deferNativeFailed(true);
          deferStatus({
            state: "fallback",
            message: `Native shortcut registration failed (${String(error)}). Focused-window fallback is active.`,
          });
        }
      }
    })();

    return () => {
      void Promise.all(registered.map((shortcut) => unregister(shortcut).catch(() => {})));
    };
  }, [deafenShortcut, isTauri, muteShortcut]);

  return status;
}
