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
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

const LOG_PREFIX = "[WebRTC]";

/** Parse ICE servers from env (memoized). */
function getIceServers(): RTCIceServer[] {
  const envJson = import.meta.env.VITE_ICE_SERVERS;
  if (!envJson) {
    console.log(`${LOG_PREFIX} No VITE_ICE_SERVERS set, using default STUN`);
    return DEFAULT_ICE_SERVERS;
  }

  try {
    const parsed = JSON.parse(envJson);
    if (Array.isArray(parsed) && parsed.length > 0) {
      console.log(`${LOG_PREFIX} Using ICE servers from env:`, parsed);
      return parsed as RTCIceServer[];
    }
  } catch (e) {
    console.error(`${LOG_PREFIX} Failed to parse VITE_ICE_SERVERS:`, e);
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
    const iceServers = getIceServers();
    console.log(`${LOG_PREFIX} Creating RTCPeerConnection with ICE servers:`, iceServers);
    this.pc = new RTCPeerConnection({ iceServers });

    // ICE candidate handling — trickle to the remote via the callback.
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candidate = event.candidate.toJSON();
        console.log(`${LOG_PREFIX} Local ICE candidate generated:`, {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
        });
        callbacks.onIceCandidate(candidate);
      } else {
        console.log(`${LOG_PREFIX} ICE gathering complete (null candidate received)`);
      }
    };

    // Remote stream handling — attach to <audio> via the callback.
    this.pc.ontrack = (event) => {
      console.log(`${LOG_PREFIX} Remote track received:`, {
        kind: event.track.kind,
        id: event.track.id,
        streams: event.streams.length,
      });
      const [remoteStream] = event.streams;
      if (remoteStream) {
        this.remoteStream = remoteStream;
        console.log(
          `${LOG_PREFIX} Remote stream attached with ${remoteStream.getTracks().length} tracks`,
        );
        callbacks.onRemoteStream(remoteStream);
      }
    };

    // Connection state changes — surface to the hook for UI updates.
    this.pc.onconnectionstatechange = () => {
      console.log(`${LOG_PREFIX} Connection state changed:`, this.pc.connectionState);
      callbacks.onConnectionStateChange(this.pc.connectionState);
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log(`${LOG_PREFIX} ICE connection state changed:`, this.pc.iceConnectionState);
      callbacks.onIceConnectionStateChange(this.pc.iceConnectionState);
    };

    this.pc.onicegatheringstatechange = () => {
      console.log(`${LOG_PREFIX} ICE gathering state changed:`, this.pc.iceGatheringState);
    };

    this.pc.onsignalingstatechange = () => {
      console.log(`${LOG_PREFIX} Signaling state changed:`, this.pc.signalingState);
    };
  }

  /** Create a PeerCall instance. Acquires getUserMedia first. */
  static async create(callbacks: PeerCallCallbacks): Promise<PeerCall> {
    console.log(`${LOG_PREFIX} Acquiring local audio stream...`);
    const localStream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
    console.log(`${LOG_PREFIX} Local audio stream acquired:`, {
      tracks: localStream.getTracks().map((t) => ({ kind: t.kind, id: t.id, enabled: t.enabled })),
    });
    const peerCall = new PeerCall(callbacks);
    peerCall.localStream = localStream;

    // Add local audio tracks to the PC.
    localStream.getTracks().forEach((track) => {
      console.log(`${LOG_PREFIX} Adding local track to PeerConnection:`, track.kind, track.id);
      peerCall.pc.addTrack(track, localStream);
    });

    return peerCall;
  }

  /** Caller path: create offer, set local description, return offer SDP. */
  async startCaller(): Promise<string> {
    console.log(`${LOG_PREFIX} [Caller] Creating offer...`);
    const offer = await this.pc.createOffer({ offerToReceiveAudio: true });
    console.log(`${LOG_PREFIX} [Caller] Offer created, setting local description...`);
    await this.pc.setLocalDescription(offer);
    console.log(
      `${LOG_PREFIX} [Caller] Local description set (offer). SDP length:`,
      offer.sdp?.length,
    );
    return offer.sdp!;
  }

  /** Callee path: set remote description (offer), create answer, return answer SDP. */
  async startCallee(remoteOfferSdp: string): Promise<string> {
    console.log(
      `${LOG_PREFIX} [Callee] Setting remote description (offer). SDP length:`,
      remoteOfferSdp.length,
    );
    await this.pc.setRemoteDescription({ type: "offer", sdp: remoteOfferSdp });
    console.log(`${LOG_PREFIX} [Callee] Remote description set. Creating answer...`);
    const answer = await this.pc.createAnswer();
    console.log(`${LOG_PREFIX} [Callee] Answer created, setting local description...`);
    await this.pc.setLocalDescription(answer);
    console.log(
      `${LOG_PREFIX} [Callee] Local description set (answer). SDP length:`,
      answer.sdp?.length,
    );
    return answer.sdp!;
  }

  /** Set remote description (answer) — called by the caller after receiving answerSdp. */
  async setRemoteAnswer(answerSdp: string): Promise<void> {
    console.log(
      `${LOG_PREFIX} [Caller] Setting remote description (answer). SDP length:`,
      answerSdp.length,
    );
    await this.pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    console.log(`${LOG_PREFIX} [Caller] Remote answer applied successfully`);
  }

  /** Add a remote ICE candidate (trickle). */
  async addRemoteIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    console.log(`${LOG_PREFIX} Adding remote ICE candidate:`, candidate.candidate);
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
    console.log(`${LOG_PREFIX} Closing PeerConnection...`);
    if (this.localStream) {
      const tracks = this.localStream.getTracks();
      console.log(`${LOG_PREFIX} Stopping ${tracks.length} local tracks`);
      tracks.forEach((track) => {
        track.stop();
        console.log(`${LOG_PREFIX} Stopped local track:`, track.kind, track.id);
      });
      this.localStream = null;
    }
    this.pc.close();
    console.log(`${LOG_PREFIX} PeerConnection closed. Final state:`, this.pc.connectionState);
    this.remoteStream = null;
  }
}
