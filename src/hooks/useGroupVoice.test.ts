/**
 * Tests for useGroupVoice hook (Phase 6).
 *
 * Mirrors the useCall.test.ts pattern: vi.mock convex/react + livekit-client,
 * renderHook + act, assert state transitions for join/leave/mute/deafen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGroupVoice } from "./useGroupVoice";
import type { Id } from "../../convex/_generated/dataModel";

// Mock sound effects
const { mockPlayJoinSound, mockPlayLeaveSound } = vi.hoisted(() => ({
  mockPlayJoinSound: vi.fn(),
  mockPlayLeaveSound: vi.fn(),
}));
vi.mock("../lib/soundEffects", () => ({
  playJoinSound: mockPlayJoinSound,
  playLeaveSound: mockPlayLeaveSound,
  unlockAudio: vi.fn().mockResolvedValue(undefined),
}));

// Mock convex/react
vi.mock("convex/react", () => ({
  useAction: vi.fn(() => vi.fn().mockResolvedValue({ token: "mock-jwt-token" })),
  useMutation: vi.fn(() => vi.fn()),
  useQuery: vi.fn(() => null),
}));

// Mock livekit-client - everything must be defined inside the factory since vi.mock is hoisted
const mockRoomEventHandlers: Record<string, (...args: unknown[]) => void> = {};
const mockRoomInstance = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  removeAllListeners: vi.fn(),
  localParticipant: {
    identity: "user-1",
    name: "User One",
    metadata: JSON.stringify({ avatarUrl: "", displayName: "User One", username: "user1" }),
    isMicrophoneEnabled: true,
    setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
  },
  remoteParticipants: new Map(),
  canPlaybackAudio: true,
  startAudio: vi.fn().mockResolvedValue(undefined),
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    mockRoomEventHandlers[event] = handler;
    return mockRoomInstance;
  }),
  off: vi.fn().mockReturnThis(),
};

/** Trigger a LiveKit RoomEvent to simulate a participant join/leave in tests. */
function emitRoomEvent(event: string, ...args: unknown[]) {
  const handler = mockRoomEventHandlers[event];
  if (handler) handler(...args);
}

vi.mock("livekit-client", () => {
  class MockRoom {
    constructor() {
      return mockRoomInstance;
    }
  }
  return {
    Room: MockRoom,
    RoomEvent: {
      ParticipantConnected: "participantConnected",
      ParticipantDisconnected: "participantDisconnected",
      ParticipantMetadataChanged: "participantMetadataChanged",
      TrackSubscribed: "trackSubscribed",
      TrackUnsubscribed: "trackUnsubscribed",
      TrackMuted: "trackMuted",
      TrackUnmuted: "trackUnmuted",
      ActiveSpeakersChanged: "activeSpeakersChanged",
      Disconnected: "disconnected",
      Reconnected: "reconnected",
      AudioPlaybackStatusChanged: "audioPlaybackChanged",
    },
  };
});

describe("useGroupVoice", () => {
  const mockUserId = "user-1" as Id<"users">;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock room state
    mockRoomInstance.connect.mockClear().mockResolvedValue(undefined);
    mockRoomInstance.disconnect.mockClear().mockResolvedValue(undefined);
    mockRoomInstance.removeAllListeners.mockClear();
    mockRoomInstance.on
      .mockClear()
      .mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        mockRoomEventHandlers[event] = handler;
        return mockRoomInstance;
      });
    mockRoomInstance.off.mockClear();
    mockRoomInstance.startAudio.mockClear().mockResolvedValue(undefined);
    Object.keys(mockRoomEventHandlers).forEach((k) => delete mockRoomEventHandlers[k]);
    mockRoomInstance.remoteParticipants.clear();
    mockRoomInstance.localParticipant.setMicrophoneEnabled.mockClear().mockResolvedValue(undefined);
    // Set up env var for LiveKit URL
    vi.stubEnv("VITE_LIVEKIT_URL", "wss://livekit.example.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("initial state", () => {
    it("starts in disconnected state", () => {
      const { result } = renderHook(() => useGroupVoice(mockUserId));

      expect(result.current.status).toBe("disconnected");
      expect(result.current.connected).toBe(false);
      expect(result.current.connecting).toBe(false);
      expect(result.current.muted).toBe(false);
      expect(result.current.deafened).toBe(false);
      expect(result.current.participants).toEqual([]);
      expect(result.current.error).toBeNull();
    });
  });

  describe("join", () => {
    it("transitions to connecting then connected", async () => {
      const { result } = renderHook(() => useGroupVoice(mockUserId));

      await act(async () => {
        await result.current.join();
      });

      // Should have called room.connect
      expect(mockRoomInstance.connect).toHaveBeenCalledWith(
        "wss://livekit.example.com",
        "mock-jwt-token",
      );

      // Should have enabled microphone
      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);

      // Should be connected
      expect(result.current.status).toBe("connected");
      expect(result.current.connected).toBe(true);
    });

    it("does nothing if already connected", async () => {
      const { result } = renderHook(() => useGroupVoice(mockUserId));

      // First join
      await act(async () => {
        await result.current.join();
      });

      expect(result.current.connected).toBe(true);

      // Try to join again
      await act(async () => {
        await result.current.join();
      });

      // Should still only have connected once
      expect(mockRoomInstance.connect).toHaveBeenCalledTimes(1);
    });

    it("plays join sound on self-join when others are already in the room", async () => {
      // Pre-populate room with a remote participant.
      const mockRemoteParticipant = {
        identity: "user-2",
        name: "User Two",
        metadata: JSON.stringify({ avatarUrl: "", displayName: "User Two", username: "user2" }),
        isMicrophoneEnabled: true,
      };
      mockRoomInstance.remoteParticipants.set("user-2", mockRemoteParticipant);

      const { result } = renderHook(() => useGroupVoice(mockUserId));

      await act(async () => {
        await result.current.join();
      });

      expect(result.current.status).toBe("connected");
      expect(mockPlayJoinSound).toHaveBeenCalled();
    });

    it("plays join sound on self-join when alone in the room", async () => {
      const { result } = renderHook(() => useGroupVoice(mockUserId));

      await act(async () => {
        await result.current.join();
      });

      expect(result.current.status).toBe("connected");
      expect(mockPlayJoinSound).toHaveBeenCalled();
    });

    it("sets error if VITE_LIVEKIT_URL is missing", async () => {
      vi.stubEnv("VITE_LIVEKIT_URL", "");
      const { result } = renderHook(() => useGroupVoice(mockUserId));

      await act(async () => {
        await result.current.join();
      });

      expect(result.current.status).toBe("disconnected");
      expect(result.current.error).toContain("VITE_LIVEKIT_URL");
      expect(mockRoomInstance.connect).not.toHaveBeenCalled();
    });

    it("handles connection failure gracefully", async () => {
      mockRoomInstance.connect.mockRejectedValueOnce(new Error("Connection failed"));
      const { result } = renderHook(() => useGroupVoice(mockUserId));

      await act(async () => {
        await result.current.join();
      });

      expect(result.current.status).toBe("disconnected");
      expect(result.current.error).toBe("Connection failed");
    });
  });

  describe("sound effects", () => {
    it("plays join sound when a remote participant connects", async () => {
      const { result } = renderHook(() => useGroupVoice(mockUserId));

      await act(async () => {
        await result.current.join();
      });

      const mockParticipant = {
        identity: "user-2",
        name: "User Two",
        metadata: JSON.stringify({ avatarUrl: "", displayName: "User Two", username: "user2" }),
      };

      act(() => {
        emitRoomEvent("participantConnected", mockParticipant);
      });

      expect(mockPlayJoinSound).toHaveBeenCalled();
    });

    it("plays leave sound when a remote participant disconnects", async () => {
      const { result } = renderHook(() => useGroupVoice(mockUserId));

      await act(async () => {
        await result.current.join();
      });

      const mockParticipant = {
        identity: "user-2",
        name: "User Two",
        metadata: JSON.stringify({ avatarUrl: "", displayName: "User Two", username: "user2" }),
      };

      act(() => {
        emitRoomEvent("participantDisconnected", mockParticipant);
      });

      expect(mockPlayLeaveSound).toHaveBeenCalled();
    });

    it("plays join sound on self-join when room is empty", async () => {
      const { result } = renderHook(() => useGroupVoice(mockUserId));

      await act(async () => {
        await result.current.join();
      });

      expect(mockPlayJoinSound).toHaveBeenCalled();
    });
  });

  describe("roster recovery", () => {
    it("rebuilds the complete participant roster after reconnecting", async () => {
      const { result } = renderHook(() => useGroupVoice(mockUserId));

      await act(async () => {
        await result.current.join();
      });

      mockRoomInstance.remoteParticipants.set("user-2", {
        identity: "user-2",
        name: "User Two",
        metadata: JSON.stringify({ avatarUrl: "", displayName: "User Two", username: "user2" }),
        isMicrophoneEnabled: true,
      });
      mockRoomInstance.remoteParticipants.set("user-3", {
        identity: "user-3",
        name: "User Three",
        metadata: JSON.stringify({ avatarUrl: "", displayName: "User Three", username: "user3" }),
        isMicrophoneEnabled: true,
      });

      act(() => {
        emitRoomEvent("reconnected");
      });

      expect(result.current.participants.map((participant) => participant.identity)).toEqual([
        "user-1",
        "user-2",
        "user-3",
      ]);
    });
  });

  describe("leave", () => {
    it("disconnects and resets state", async () => {
      const { result } = renderHook(() => useGroupVoice(mockUserId));

      // Join first
      await act(async () => {
        await result.current.join();
      });
      expect(result.current.connected).toBe(true);

      // Leave
      await act(async () => {
        await result.current.leave();
      });

      expect(result.current.status).toBe("disconnected");
      expect(result.current.connected).toBe(false);
      expect(mockRoomInstance.disconnect).toHaveBeenCalled();
      expect(mockPlayLeaveSound).toHaveBeenCalled();
    });

    it("does nothing if not connected", async () => {
      const { result } = renderHook(() => useGroupVoice(mockUserId));

      await act(async () => {
        await result.current.leave();
      });

      expect(mockRoomInstance.disconnect).not.toHaveBeenCalled();
    });
  });

  describe("mute", () => {
    it("disables microphone when muted", async () => {
      const { result } = renderHook(() => useGroupVoice(mockUserId));

      await act(async () => {
        await result.current.join();
      });

      await act(async () => {
        result.current.setMuted(true);
      });

      expect(result.current.muted).toBe(true);
      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
    });

    it("enables microphone when unmuted", async () => {
      const { result } = renderHook(() => useGroupVoice(mockUserId));

      await act(async () => {
        await result.current.join();
      });

      await act(async () => {
        result.current.setMuted(true);
      });

      await act(async () => {
        result.current.setMuted(false);
      });

      expect(result.current.muted).toBe(false);
      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    });
  });

  describe("deafen", () => {
    it("mutes microphone and audio when deafened", async () => {
      const { result } = renderHook(() => useGroupVoice(mockUserId));

      await act(async () => {
        await result.current.join();
      });

      await act(async () => {
        result.current.setDeafened(true);
      });

      expect(result.current.deafened).toBe(true);
      expect(result.current.muted).toBe(true);
      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
    });

    it("restores microphone and audio when undeafened", async () => {
      const { result } = renderHook(() => useGroupVoice(mockUserId));

      await act(async () => {
        await result.current.join();
      });

      await act(async () => {
        result.current.setDeafened(true);
      });

      await act(async () => {
        result.current.setDeafened(false);
      });

      expect(result.current.deafened).toBe(false);
      expect(result.current.muted).toBe(false);
      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    });
  });

  describe("cleanup on unmount", () => {
    it("calls leave() on unmount when connected", async () => {
      const { result, unmount } = renderHook(() => useGroupVoice(mockUserId));

      await act(async () => {
        await result.current.join();
      });

      expect(result.current.connected).toBe(true);

      unmount();

      expect(mockRoomInstance.disconnect).toHaveBeenCalled();
    });

    it("does not call leave() on unmount when disconnected", () => {
      const { unmount } = renderHook(() => useGroupVoice(mockUserId));

      unmount();

      expect(mockRoomInstance.disconnect).not.toHaveBeenCalled();
    });
  });
});
