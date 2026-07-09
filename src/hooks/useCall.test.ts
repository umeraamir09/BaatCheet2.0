/**
 * Tests for useCall hook — focuses on the cleanup-on-unmount bug regression
 * and state machine transitions.
 *
 * The primary bug (now fixed): useEffect cleanup with [status, leave] deps
 * caused instant disconnect when status changed (e.g., initiating → connected).
 * React runs the PREVIOUS effect's cleanup on dep change, which captured the
 * old status and called leave() if it wasn't idle/ended.
 *
 * Fix: Use statusRef.current in cleanup and empty deps [] so cleanup only
 * fires on actual unmount.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { setupWebRTCMocks, resetWebRTCMocks } from "../test/mocks";

// Create mock functions for Convex
const mockStartCall = vi.fn().mockResolvedValue("mock-call-id");
const mockAnswerCall = vi.fn().mockResolvedValue(undefined);
const mockRejectCall = vi.fn().mockResolvedValue(undefined);
const mockEndCall = vi.fn().mockResolvedValue(undefined);
const mockMarkMissed = vi.fn().mockResolvedValue(undefined);
const mockAddIceCandidate = vi.fn().mockResolvedValue(undefined);
const mockGetCall = vi.fn().mockReturnValue(null);
const mockListIncomingCalls = vi.fn().mockReturnValue(null);

// Track which mutation/query is being called
let mutationCallCount = 0;
let queryCallCount = 0;

// Setup Convex mocks before importing useCall
vi.mock("convex/react", () => ({
  useMutation: () => {
    mutationCallCount++;
    // Return mocks in order: startCall, answerCall, rejectCall, endCall, markMissed, addIceCandidate
    const mocks = [
      mockStartCall,
      mockAnswerCall,
      mockRejectCall,
      mockEndCall,
      mockMarkMissed,
      mockAddIceCandidate,
    ];
    return mocks[mutationCallCount - 1] || vi.fn().mockResolvedValue(undefined);
  },
  useQuery: () => {
    queryCallCount++;
    // Return mocks in order: getCall, listIncomingCalls
    const mocks = [mockGetCall, mockListIncomingCalls];
    return mocks[queryCallCount - 1] || null;
  },
}));

// Import after mocks are set up
import { useCall } from "./useCall";

describe("useCall", () => {
  beforeEach(() => {
    setupWebRTCMocks();
    mutationCallCount = 0;
    queryCallCount = 0;
    vi.clearAllMocks();
    mockStartCall.mockResolvedValue("mock-call-id");
    mockGetCall.mockReturnValue(null);
    mockListIncomingCalls.mockReturnValue(null);
  });

  afterEach(() => {
    resetWebRTCMocks();
  });

  describe("initial state", () => {
    it("starts in idle state with no call", () => {
      const { result } = renderHook(() => useCall("user-1" as any));

      expect(result.current.status).toBe("idle");
      expect(result.current.callId).toBeNull();
      expect(result.current.peerUserId).toBeNull();
      expect(result.current.incomingCall).toBeNull();
    });
  });

  describe("cleanup-on-unmount bug regression", () => {
    it("does NOT call leave() when status changes from initiating to connected (the bug)", async () => {
      // This test verifies the fix for the primary bug:
      // The old code had useEffect with [status, leave] deps, and the cleanup
      // captured the old status. When status changed initiating → connected,
      // React ran the old cleanup which saw status="initiating" (not idle/ended)
      // and called leave(), instantly disconnecting the call.

      const { result } = renderHook(() => useCall("user-1" as any));

      // Start a call
      await act(async () => {
        await result.current.startCall("user-2" as any, {
          displayName: "Test User",
          username: "testuser",
          avatarUrl: "https://example.com/avatar.png",
        });
      });

      // Status should be initiating
      expect(result.current.status).toBe("initiating");

      // Simulate the call being accepted (callDoc status → accepted)
      mockGetCall.mockReturnValue({
        _id: "mock-call-id",
        callerId: "user-1",
        calleeId: "user-2",
        status: "accepted",
        offerSdp: "mock-offer-sdp",
        answerSdp: "mock-answer-sdp",
        callerIceCandidates: [],
        calleeIceCandidates: [],
        startedAt: Date.now(),
        connectedAt: Date.now(),
        endedAt: null,
        endReason: null,
      });

      // Trigger re-render with new callDoc
      await act(async () => {});

      // Status should transition to connected
      expect(result.current.status).toBe("connected");

      // CRITICAL: endCall mutation should NOT have been called
      // (the bug would have called it when status changed)
      expect(mockEndCall).not.toHaveBeenCalled();
    });

    it("calls leave() on actual component unmount when call is active", async () => {
      const { result, unmount } = renderHook(() => useCall("user-1" as any));

      // Start a call
      await act(async () => {
        await result.current.startCall("user-2" as any, {
          displayName: "Test User",
          username: "testuser",
          avatarUrl: "https://example.com/avatar.png",
        });
      });

      expect(result.current.status).toBe("initiating");

      // Unmount the hook
      unmount();

      // endCall should be called on unmount
      expect(mockEndCall).toHaveBeenCalledWith({
        callId: "mock-call-id",
        reason: "left",
      });
    });

    it("does NOT call leave() on unmount when status is idle", () => {
      const { unmount } = renderHook(() => useCall("user-1" as any));

      // Status is idle, unmount
      unmount();

      // endCall should NOT be called
      expect(mockEndCall).not.toHaveBeenCalled();
    });

    it("does NOT call leave() on unmount when status is ended", async () => {
      const { result, unmount } = renderHook(() => useCall("user-1" as any));

      // Start and end a call
      await act(async () => {
        await result.current.startCall("user-2" as any, {
          displayName: "Test User",
          username: "testuser",
          avatarUrl: "https://example.com/avatar.png",
        });
      });

      await act(async () => {
        await result.current.leave("left");
      });

      expect(result.current.status).toBe("ended");

      // Clear the mock to check no further calls
      mockEndCall.mockClear();

      // Unmount
      unmount();

      // endCall should NOT be called again
      expect(mockEndCall).not.toHaveBeenCalled();
    });
  });

  describe("caller path", () => {
    it("creates call doc and sets status to initiating", async () => {
      const { result } = renderHook(() => useCall("user-1" as any));

      await act(async () => {
        await result.current.startCall("user-2" as any, {
          displayName: "Test User",
          username: "testuser",
          avatarUrl: "https://example.com/avatar.png",
        });
      });

      expect(result.current.status).toBe("initiating");
      expect(result.current.peerUserId).toBe("user-2");
      expect(mockStartCall).toHaveBeenCalledWith({
        callerId: "user-1",
        calleeId: "user-2",
        offerSdp: "mock-offer-sdp",
      });
    });

    it("transitions to connected when call is accepted", async () => {
      const { result } = renderHook(() => useCall("user-1" as any));

      // Start call
      await act(async () => {
        await result.current.startCall("user-2" as any, {
          displayName: "Test User",
          username: "testuser",
          avatarUrl: "https://example.com/avatar.png",
        });
      });

      expect(result.current.status).toBe("initiating");

      // Simulate acceptance
      mockGetCall.mockReturnValue({
        _id: "mock-call-id",
        callerId: "user-1",
        calleeId: "user-2",
        status: "accepted",
        offerSdp: "mock-offer-sdp",
        answerSdp: "mock-answer-sdp",
        callerIceCandidates: [],
        calleeIceCandidates: [],
        startedAt: Date.now(),
        connectedAt: Date.now(),
        endedAt: null,
        endReason: null,
      });

      await act(async () => {});

      expect(result.current.status).toBe("connected");
    });
  });

  describe("callee path", () => {
    it("shows incoming call when call doc arrives", () => {
      mockListIncomingCalls.mockReturnValue({
        _id: "incoming-call-id",
        callerId: "user-2",
        calleeId: "user-1",
        status: "calling",
        offerSdp: "mock-offer-sdp",
        startedAt: Date.now(),
        caller: {
          displayName: "Caller",
          username: "caller",
          avatarUrl: "https://example.com/caller.png",
        },
      });

      const { result } = renderHook(() => useCall("user-1" as any));

      expect(result.current.incomingCall).not.toBeNull();
      expect(result.current.incomingCall?._id).toBe("incoming-call-id");
      expect(result.current.incomingCall?.callerId).toBe("user-2");
    });

    it("accepts call and transitions to connected", async () => {
      mockListIncomingCalls.mockReturnValue({
        _id: "incoming-call-id",
        callerId: "user-2",
        calleeId: "user-1",
        status: "calling",
        offerSdp: "mock-offer-sdp",
        startedAt: Date.now(),
        caller: {
          displayName: "Caller",
          username: "caller",
          avatarUrl: "https://example.com/caller.png",
        },
      });

      const { result } = renderHook(() => useCall("user-1" as any));

      expect(result.current.incomingCall).not.toBeNull();

      // Accept the call
      await act(async () => {
        await result.current.accept();
      });

      expect(mockAnswerCall).toHaveBeenCalledWith({
        callId: "incoming-call-id",
        answerSdp: "mock-answer-sdp",
      });

      // Simulate acceptance
      mockGetCall.mockReturnValue({
        _id: "incoming-call-id",
        callerId: "user-2",
        calleeId: "user-1",
        status: "accepted",
        offerSdp: "mock-offer-sdp",
        answerSdp: "mock-answer-sdp",
        callerIceCandidates: [],
        calleeIceCandidates: [],
        startedAt: Date.now(),
        connectedAt: Date.now(),
        endedAt: null,
        endReason: null,
      });

      await act(async () => {});

      expect(result.current.status).toBe("connected");
    });

    it("rejects call and transitions to ended", async () => {
      mockListIncomingCalls.mockReturnValue({
        _id: "incoming-call-id",
        callerId: "user-2",
        calleeId: "user-1",
        status: "calling",
        offerSdp: "mock-offer-sdp",
        startedAt: Date.now(),
        caller: {
          displayName: "Caller",
          username: "caller",
          avatarUrl: "https://example.com/caller.png",
        },
      });

      const { result } = renderHook(() => useCall("user-1" as any));

      await act(async () => {
        await result.current.reject();
      });

      expect(mockRejectCall).toHaveBeenCalledWith({
        callId: "incoming-call-id",
      });
      expect(result.current.status).toBe("ended");
    });
  });

  describe("auto-reject busy handling (Decision D11)", () => {
    it("auto-rejects incoming call when already in a call", async () => {
      const { result } = renderHook(() => useCall("user-1" as any));

      // Start a call (status → initiating)
      await act(async () => {
        await result.current.startCall("user-2" as any, {
          displayName: "Test User",
          username: "testuser",
          avatarUrl: "https://example.com/avatar.png",
        });
      });

      expect(result.current.status).toBe("initiating");

      // Now an incoming call arrives
      mockListIncomingCalls.mockReturnValue({
        _id: "incoming-call-id-2",
        callerId: "user-3",
        calleeId: "user-1",
        status: "calling",
        offerSdp: "mock-offer-sdp-2",
        startedAt: Date.now(),
        caller: {
          displayName: "Caller 2",
          username: "caller2",
          avatarUrl: "https://example.com/caller2.png",
        },
      });

      await act(async () => {});

      // Should auto-reject (no toast shown)
      expect(mockRejectCall).toHaveBeenCalledWith({
        callId: "incoming-call-id-2",
      });
    });
  });

  describe("leave", () => {
    it("calls endCall mutation and transitions to ended", async () => {
      const { result } = renderHook(() => useCall("user-1" as any));

      await act(async () => {
        await result.current.startCall("user-2" as any, {
          displayName: "Test User",
          username: "testuser",
          avatarUrl: "https://example.com/avatar.png",
        });
      });

      await act(async () => {
        await result.current.leave("left");
      });

      expect(mockEndCall).toHaveBeenCalledWith({
        callId: "mock-call-id",
        reason: "left",
      });
      expect(result.current.status).toBe("ended");
    });

    it("does nothing if no call is active", async () => {
      const { result } = renderHook(() => useCall("user-1" as any));

      await act(async () => {
        await result.current.leave("left");
      });

      expect(mockEndCall).not.toHaveBeenCalled();
    });
  });
});
