import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEYBINDS,
  eventToKeybind,
  formatGlobalShortcut,
  findDuplicateAction,
  formatKeybind,
  isReservedKeybind,
  keybindsEqual,
} from "./keybinds";

describe("keybinds", () => {
  it("formats default mute and deafen bindings", () => {
    expect(formatKeybind(DEFAULT_KEYBINDS.toggleMute.binding)).toBe("Ctrl+Shift+M");
    expect(formatKeybind(DEFAULT_KEYBINDS.toggleDeafen.binding)).toBe("Ctrl+Shift+D");
    expect(formatGlobalShortcut(DEFAULT_KEYBINDS.toggleMute.binding)).toBe(
      "CommandOrControl+Shift+M",
    );
  });

  it("normalizes keyboard events into comparable bindings", () => {
    const binding = eventToKeybind({
      key: "m",
      code: "KeyM",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    });

    expect(formatKeybind(binding)).toBe("Ctrl+Shift+M");
    expect(keybindsEqual(binding, DEFAULT_KEYBINDS.toggleMute.binding)).toBe(true);
  });

  it("ignores modifier-only events", () => {
    expect(
      eventToKeybind({
        key: "Control",
        code: "ControlLeft",
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      }),
    ).toBeNull();
  });

  it("rejects reserved browser/app shortcuts", () => {
    const reload = eventToKeybind({
      key: "r",
      code: "KeyR",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    });

    expect(reload).not.toBeNull();
    expect(isReservedKeybind(reload!)).toBe(true);
  });

  it("detects duplicate actions", () => {
    const duplicate = findDuplicateAction(
      DEFAULT_KEYBINDS,
      "toggleMute",
      DEFAULT_KEYBINDS.toggleDeafen.binding!,
    );

    expect(duplicate).toBe("toggleDeafen");
  });
});
