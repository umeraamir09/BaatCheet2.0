/**
 * Phase 4 — Raw WebRTC wrapper (Decision D4).
 *
 * A thin wrapper around the browser `RTCPeerConnection`. No external dependency
 * (no simple-peer/peerjs). The roadmap says Phase 4 is "a good place to learn
 * the WebRTC API," so the wrapper keeps the API explicit.
 *
 * ICE servers config is read from `import.meta.env.VITE_ICE_SERVERS` (JSON
 * string of `RTCIceServer[]`). If unset, falls back to Google's public STUN
 * (stun:stun.l.google.com:19302) so local dev without coturn still gets
 * host/srflx candidates.
 *
 * The `PeerCall` class owns the `RTCPeerConnection` lifecycle: offer/answer
 * creation, ICE candidate handling, remote stream attachment, mute/deafen/leave.
 */

/** Default ICE servers if VITE_ICE_SERVERS is unset. */
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

/** Parse ICE servers from env (memoized). */
function getIceServers(): RTCIceServer[] {
  const envJson = import.meta.env.VITE_ICE_SERVERS;
  if (!envJson) return DEFAULT_ICE_SERVERS;

  try {
    const parsed = JSON.parse(envJson);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as RTCIceServer[];
    }
  } catch (e) {
    console.error("Failed to parse VITE_ICE_SERVERS:", e);
  }
  return DEFAULT_ICE_SERVERS;
}

/** getUserMedia constraints for voice-only. */
const AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: false,
};

export interface PeerCallCallbacks {
  onIceCandidate: (candidate: RTCIceCandidateInit) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  onIceConnectionStateChange: (state: RTCIceConnectionState) => void;
}

/**
 * PeerCall — wraps RTCPeerConnection for a 1:1 voice call.
 *
 * Caller path: create() → startCaller() → offerSdp → (send via startCall mutation)
 *   → on answerSdp → setRemoteDescription(answer) → connected.
 * Callee path: create() → startCallee(offerSdp) → answerSdp → (send via answerCall mutation)
 *   → connected.
 *
 * Both sides: onIceCandidate → addIceCandidate mutation; onRemoteStream → attach to <audio>.
 */
export class PeerCall {
  private pc: RTCPeerConnection;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;

  private constructor(callbacks: PeerCallCallbacks) {
    this.pc = new RTCPeerConnection({ iceServers: getIceServers() });

    // ICE candidate handling — trickle to the remote via the callback.
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        callbacks.onIceCandidate(event.candidate.toJSON());
      }
    };

    // Remote stream handling — attach to <audio> via the callback.
    this.pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        this.remoteStream = remoteStream;
        callbacks.onRemoteStream(remoteStream);
      }
    };

    // Connection state changes — surface to the hook for UI updates.
    this.pc.onconnectionstatechange = () => {
      callbacks.onConnectionStateChange(this.pc.connectionState);
    };

    this.pc.oniceconnectionstatechange = () => {
      callbacks.onIceConnectionStateChange(this.pc.iceConnectionState);
    };
  }

  /** Create a PeerCall instance. Acquires getUserMedia first. */
  static async create(callbacks: PeerCallCallbacks): Promise<PeerCall> {
    const localStream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
    const peerCall = new PeerCall(callbacks);
    peerCall.localStream = localStream;

    // Add local audio tracks to the PC.
    localStream.getTracks().forEach((track) => {
      peerCall.pc.addTrack(track, localStream);
    });

    return peerCall;
  }

  /** Caller path: create offer, set local description, return offer SDP. */
  async startCaller(): Promise<string> {
    const offer = await this.pc.createOffer({ offerToReceiveAudio: true });
    await this.pc.setLocalDescription(offer);
    return offer.sdp!;
  }

  /** Callee path: set remote description (offer), create answer, return answer SDP. */
  async startCallee(remoteOfferSdp: string): Promise<string> {
    await this.pc.setRemoteDescription({ type: "offer", sdp: remoteOfferSdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer.sdp!;
  }

  /** Set remote description (answer) — called by the caller after receiving answerSdp. */
  async setRemoteAnswer(answerSdp: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  }

  /** Add a remote ICE candidate (trickle). */
  async addRemoteIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    await this.pc.addIceCandidate(candidate);
  }

  /** Toggle local audio track (mute/unmute). */
  setMuted(muted: boolean): void {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }

  /**
   * Deafen: mute remote audio + mute local mic (Discord semantics).
   * You can't hear, and you don't accidentally talk.
   */
  setDeafened(deafened: boolean): void {
    // Mute remote audio — the <audio> element's `muted` property is controlled
    // by the hook (it has a ref to the element). We just mute the local mic here.
    this.setMuted(deafened);
  }

  /** Get the local audio stream (for UI inspection). */
  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  /** Get the remote audio stream (for UI inspection). */
  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  /** Close the PC + stop all tracks. */
  close(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    this.pc.close();
    this.remoteStream = null;
  }
}
