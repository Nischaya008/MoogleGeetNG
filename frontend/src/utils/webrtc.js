/**
 * WebRTC utility functions for managing peer connections and media streams
 */

/**
 * Creates a new RTCPeerConnection with proper configuration
 */
export function createPeerConnection() {
  const config = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };
  return new RTCPeerConnection(config);
}

/**
 * Adds all tracks from a MediaStream to an RTCPeerConnection
 * @param {RTCPeerConnection} pc - The peer connection
 * @param {MediaStream} stream - The media stream to add tracks from
 */
export function addTracksToPeerConnection(pc, stream) {
  if (!stream) return;
  
  const existingSenders = new Set(
    pc.getSenders().map(sender => sender.track?.kind)
  );
  
  stream.getTracks().forEach(track => {
    // Only add if we don't already have a track of this kind
    if (!existingSenders.has(track.kind)) {
      pc.addTrack(track, stream);
      console.log(`[RTC] Added ${track.kind} track to peer connection`);
    }
  });
}

/**
 * Gets track counts from a MediaStream
 */
export function getTrackCounts(stream) {
  if (!stream) return { audio: 0, video: 0 };
  const audioTracks = stream.getAudioTracks().length;
  const videoTracks = stream.getVideoTracks().length;
  return { audio: audioTracks, video: videoTracks };
}

/**
 * Cross-browser getUserMedia with graceful fallback.
 * Also provides a helpful error when not in a secure context (HTTPS/localhost).
 * @param {MediaStreamConstraints} constraints
 * @returns {Promise<MediaStream>}
 */
export function getUserMediaCompat(constraints) {
  // Secure context check (required for getUserMedia on most browsers)
  const isSecure = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!isSecure) {
    const err = new Error('getUserMedia requires HTTPS or localhost. Please open this site with https:// or run the dev server with --https.');
    err.name = 'InsecureContextError';
    return Promise.reject(err);
  }

  if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  const legacyGetUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
  if (legacyGetUserMedia) {
    return new Promise((resolve, reject) => legacyGetUserMedia.call(navigator, constraints, resolve, reject));
  }

  const err = new Error('navigator.mediaDevices.getUserMedia is not supported in this browser.');
  err.name = 'NotSupportedError';
  return Promise.reject(err);
}

