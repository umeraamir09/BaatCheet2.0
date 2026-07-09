/**
 * WebRTC and Convex mocks for testing useCall hook.
 */
import { vi } from "vitest";

// Mock RTCPeerConnection
export const mockPeerConnection = {
  close: vi.fn(),
  createOffer: vi.fn().mockResolvedValue({ sdp: "mock-offer-sdp", type: "offer" }),
  createAnswer: vi.fn().mockResolvedValue({ sdp: "mock-answer-sdp", type: "answer" }),
  setLocalDescription: vi.fn().mockResolvedValue(undefined),
  setRemoteDescription: vi.fn().mockResolvedValue(undefined),
  addIceCandidate: vi.fn().mockResolvedValue(undefined),
  addTrack: vi.fn(),
  getStats: vi.fn().mockResolvedValue([]),
  connectionState: "new",
  iceConnectionState: "new",
  iceGatheringState: "new",
  signalingState: "stable",
  localDescription: null,
  remoteDescription: null,
  onicecandidate: null as ((event: { candidate: RTCIceCandidate | null }) => void) | null,
  ontrack: null as ((event: RTCTrackEvent) => void) | null,
  onconnectionstatechange: null as (() => void) | null,
  oniceconnectionstatechange: null as (() => void) | null,
  onicegatheringstatechange: null as (() => void) | null,
  onsignalingstatechange: null as (() => void) | null,
};

export const mockGetUserMedia = vi.fn().mockResolvedValue({
  getTracks: vi
    .fn()
    .mockReturnValue([{ kind: "audio", id: "mock-track-1", enabled: true, stop: vi.fn() }]),
  getAudioTracks: vi
    .fn()
    .mockReturnValue([{ kind: "audio", id: "mock-track-1", enabled: true, stop: vi.fn() }]),
});

export function setupWebRTCMocks() {
  // Mock navigator.mediaDevices.getUserMedia
  Object.defineProperty(global.navigator, "mediaDevices", {
    value: {
      getUserMedia: mockGetUserMedia,
    },
    writable: true,
    configurable: true,
  });

  // Mock RTCPeerConnection
  vi.stubGlobal(
    "RTCPeerConnection",
    vi.fn(() => mockPeerConnection),
  );
}

export function resetWebRTCMocks() {
  vi.clearAllMocks();
  mockPeerConnection.close.mockClear();
  mockPeerConnection.createOffer.mockClear();
  mockPeerConnection.createAnswer.mockClear();
  mockPeerConnection.setLocalDescription.mockClear();
  mockPeerConnection.setRemoteDescription.mockClear();
  mockPeerConnection.addIceCandidate.mockClear();
  mockPeerConnection.addTrack.mockClear();
  mockPeerConnection.onicecandidate = null;
  mockPeerConnection.ontrack = null;
  mockPeerConnection.onconnectionstatechange = null;
  mockPeerConnection.oniceconnectionstatechange = null;
  mockPeerConnection.onicegatheringstatechange = null;
  mockPeerConnection.onsignalingstatechange = null;
}
