/**
 * WebRTC, Convex, and LiveKit mocks for testing useCall and useGroupVoice hooks.
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

  // Mock RTCPeerConnection — use regular function so `new` works
  vi.stubGlobal(
    "RTCPeerConnection",
    vi.fn(function () {
      return mockPeerConnection;
    }),
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

// ============================================================================
// LiveKit mocks for useGroupVoice
// ============================================================================

export const mockLocalParticipant = {
  identity: "user-1",
  name: "User One",
  metadata: JSON.stringify({ avatarUrl: "", displayName: "User One", username: "user1" }),
  isMicrophoneEnabled: true,
  setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
};

export const mockRemoteParticipant = {
  identity: "user-2",
  name: "User Two",
  metadata: JSON.stringify({ avatarUrl: "", displayName: "User Two", username: "user2" }),
  isMicrophoneEnabled: true,
  isSpeaking: false,
};

export const mockRemoteTrack = {
  kind: "audio",
  attach: vi.fn().mockReturnValue({
    autoplay: false,
    remove: vi.fn(),
  }),
  detach: vi.fn().mockReturnValue([]),
};

export const mockRoom = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  removeAllListeners: vi.fn(),
  localParticipant: mockLocalParticipant,
  remoteParticipants: new Map(),
  canPlaybackAudio: true,
  startAudio: vi.fn().mockResolvedValue(undefined),
  on: vi.fn().mockReturnThis(),
  off: vi.fn().mockReturnThis(),
};

export const MockRoomClass = vi.fn(() => mockRoom);

export function setupLiveKitMocks() {
  vi.mock("livekit-client", () => ({
    Room: MockRoomClass,
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
      AudioPlaybackStatusChanged: "audioPlaybackChanged",
    },
  }));
}

export function resetLiveKitMocks() {
  mockRoom.connect.mockClear();
  mockRoom.disconnect.mockClear();
  mockRoom.removeAllListeners.mockClear();
  mockRoom.on.mockClear().mockReturnThis();
  mockRoom.off.mockClear();
  mockRoom.startAudio.mockClear();
  mockRoom.remoteParticipants.clear();
  mockLocalParticipant.setMicrophoneEnabled.mockClear();
  mockRemoteTrack.attach.mockClear();
  mockRemoteTrack.detach.mockClear();
}
