import { useEffect, useState, useRef } from 'react';
import { getCurrentUser, getUserById } from '../api/auth';
import { fetchRoomById } from '../api/room';
import { io } from 'socket.io-client';
import { createPeerConnection, addTracksToPeerConnection, getTrackCounts, getUserMediaCompat } from '../utils/webrtc';
import CryptoJS from 'crypto-js';
import './RoomPage.css';
import micUnmutedIcon from '../assets/mic_unmuted.png';
import micMutedIcon from '../assets/mic_muted.png';
import cameraOnIcon from '../assets/camera_on.png';
import cameraOffIcon from '../assets/camera_off.png';

const SOCKET_URL = import.meta.env.VITE_SOCKET_IO_URL || 'http://localhost:5000';

export default function RoomPage({ roomid, setRoute }) {
  const [user, setUser] = useState(null);
  const [room, setRoom] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [participantUsers, setParticipantUsers] = useState(new Map());
  const [waiting, setWaiting] = useState([]);
  const [waitingUsers, setWaitingUsers] = useState(new Map());
  const [isHost, setIsHost] = useState(false);
  const [hostUserId, setHostUserId] = useState(null);
  const [hostUserInfo, setHostUserInfo] = useState(null);
  const [hostActive, setHostActive] = useState(true);
  const [socketConnected, setSocketConnected] = useState(false);
  
  // WebRTC state
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map()); // userId -> MediaStream
  const [mediaStates, setMediaStates] = useState(new Map()); // userId -> { micEnabled, cameraEnabled }
  const [mediaError, setMediaError] = useState(null);
  const [localMicEnabled, setLocalMicEnabled] = useState(true);
  const [localCameraEnabled, setLocalCameraEnabled] = useState(true);
  const [currentVideoPage, setCurrentVideoPage] = useState(0);
  const [videosPerPage, setVideosPerPage] = useState(6);
  const [currentParticipantsPage, setCurrentParticipantsPage] = useState(0);
  const [participantsPerPage, setParticipantsPerPage] = useState(10);
  const [participantsCollapsed, setParticipantsCollapsed] = useState(false);
  const [sidebarView, setSidebarView] = useState('participants'); // 'participants' or 'chat'
  const [speakingUsers, setSpeakingUsers] = useState(new Set()); // Track users who are actually speaking
  
  const socketRef = useRef(null);
  const audioAnalyzersRef = useRef(new Map()); // userId -> { analyser, dataArray, animationFrame }
  
  // Calculate responsive videos per page based on screen size
  useEffect(() => {
    const updateVideosPerPage = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      // Calculate based on available space
      if (width >= 1920 && height >= 1080) {
        setVideosPerPage(12);
      } else if (width >= 1400 && height >= 900) {
        setVideosPerPage(9);
      } else if (width >= 1024 && height >= 768) {
        setVideosPerPage(6);
      } else if (width >= 768 && height >= 600) {
        setVideosPerPage(4);
      } else if (width >= 480 && height >= 500) {
        setVideosPerPage(3);
      } else {
        setVideosPerPage(2);
      }
    };
    
    updateVideosPerPage();
    window.addEventListener('resize', updateVideosPerPage);
    return () => window.removeEventListener('resize', updateVideosPerPage);
  }, []);
  
  // Calculate responsive participants per page based on screen size
  useEffect(() => {
    const updateParticipantsPerPage = () => {
      const height = window.innerHeight;
      // Calculate based on available vertical space in participants card
      if (height >= 1080) {
        setParticipantsPerPage(15);
      } else if (height >= 900) {
        setParticipantsPerPage(12);
      } else if (height >= 768) {
        setParticipantsPerPage(10);
      } else if (height >= 600) {
        setParticipantsPerPage(8);
      } else {
        setParticipantsPerPage(5);
      }
    };
    
    updateParticipantsPerPage();
    window.addEventListener('resize', updateParticipantsPerPage);
    return () => window.removeEventListener('resize', updateParticipantsPerPage);
  }, []);
  
  // Reset pagination when participants change
  useEffect(() => {
    setCurrentVideoPage(0);
    setCurrentParticipantsPage(0);
  }, [participants.length]);
  const peersRef = useRef(new Map()); // userId -> RTCPeerConnection
  const remoteVideoRefs = useRef(new Map()); // userId -> video element ref
  const localVideoRef = useRef(null);
  const pendingCandidatesRef = useRef(new Map()); // userId -> RTCIceCandidate[]
  const offerTimeoutRef = useRef(new Map()); // userId -> timeout ID

  useEffect(() => {
    (async () => {
      const u = await getCurrentUser();
      if (!u) { window.location.href = '/enter'; return; }
      setUser(u);
      // Fetch room data to check if locked and if user is host
      try {
        const r = await fetchRoomById(roomid);
        setRoom(r);
        setIsHost(r.createdBy === u.userid);
        setHostUserId(r.createdBy);
        // Fetch host user info for display
        try {
          const hostInfo = await getUserById(r.createdBy);
          setHostUserInfo(hostInfo);
        } catch (e) {
          console.warn('Failed to fetch host info:', e);
        }
        // If room is locked AND user is not host AND user is not in participants, redirect to lobby
        // BUT: if user was just approved, they might not be in the initial fetch - wait for socket update
        if (r.locked && r.createdBy !== u.userid && !r.participants.includes(u.userid)) {
          // Don't redirect immediately - wait a bit for socket to connect and update participants list
          // The redirect will happen in the useEffect that watches participants if still not present after socket connects
          // This prevents the race condition where user is approved but initial room fetch hasn't updated yet
        }
      } catch (e) {
        console.error('Failed to fetch room:', e);
      }
    })();
  }, [roomid, setRoute]);

  // Fetch user data for participants and waiting
  useEffect(() => {
    const fetchUsers = async (userids) => {
      const userMap = new Map();
      for (const uid of userids) {
        try {
          const u = await getUserById(uid);
          userMap.set(uid, u);
        } catch (e) {
          // Fallback to showing userid if fetch fails
          userMap.set(uid, { userid: uid, username: uid, fullname: uid });
        }
      }
      return userMap;
    };
    if (participants.length > 0) {
      fetchUsers(participants).then(setParticipantUsers);
    }
    if (waiting.length > 0) {
      fetchUsers(waiting).then(setWaitingUsers);
    }
  }, [participants, waiting]);

  // Initialize local media stream
  useEffect(() => {
    if (!user) return;
    
    let stream = null;
    let mounted = true;
    
    const initMedia = async () => {
      try {
        // Try A/V first
        stream = await getUserMediaCompat({ audio: true, video: true });
      } catch (err) {
        console.error('[MEDIA] Failed to get user media (audio+video):', err);
        // Device contention (same laptop/tabs) or no camera: fallback to audio-only
        if (err && (err.name === 'NotReadableError' || err.name === 'NotFoundError' || err.name === 'AbortError')) {
          try {
            stream = await getUserMediaCompat({ audio: true, video: false });
            console.log('[MEDIA] Fallback to audio-only (camera unavailable)');
          } catch (err2) {
            console.error('[MEDIA] Fallback audio-only failed:', err2);
            setMediaError(err2.message || 'Failed to access microphone');
            if (!mounted) return;
            return;
          }
        } else {
          setMediaError(err.message || 'Failed to access camera/microphone');
          if (!mounted) return;
          return;
        }
      }

      if (!mounted) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      setLocalStream(stream);
      const counts = getTrackCounts(stream);
      console.log(`[MEDIA] Local tracks audio=${counts.audio} video=${counts.video}`);
      
      // Set initial media states
      const micEnabled = stream.getAudioTracks()[0]?.enabled ?? true;
      const cameraEnabled = stream.getVideoTracks()[0]?.enabled ?? false; // false when no video track
      setLocalMicEnabled(micEnabled);
      setLocalCameraEnabled(cameraEnabled);
      
      // Send initial media state to other participants
      if (socketRef.current && user) {
        socketRef.current.emit('media-toggle', {
          roomid,
          userid: user.userid,
          micEnabled,
          cameraEnabled
        });
      }
      
      // Add tracks to all existing peer connections
      peersRef.current.forEach((pc, userId) => {
        if (pc.connectionState !== 'closed') {
          addTracksToPeerConnection(pc, stream);
        }
      });
    };
    
    initMedia();
    
    return () => {
      mounted = false;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [user]);

  // When localStream becomes available, add tracks to all existing PCs
  useEffect(() => {
    if (!localStream) return;
    
    peersRef.current.forEach((pc, userId) => {
      if (pc.connectionState !== 'closed') {
        addTracksToPeerConnection(pc, localStream);
      }
    });
  }, [localStream]);

  // Check if user should be redirected to lobby (only after socket connects and we have updated participants list)
  useEffect(() => {
    if (!user || !room || !socketConnected || isHost || !room.locked) return;
    // Only redirect to lobby if user is not in participants
    // Add a delay to ensure participants list has been updated from socket
    // Longer delay for recently approved users (grace period)
    const timer = setTimeout(() => {
      if (!participants.includes(user.userid)) {
        console.log('[RoomPage] User not in participants after socket connect, redirecting to lobby');
        setRoute(`/room/${roomid}/lobby`);
      }
    }, 1000); // 1 second delay to allow socket participants-update to arrive and backend grace period to work
    
    return () => clearTimeout(timer);
  }, [user, room, participants, socketConnected, isHost, roomid, setRoute]);

  // WebRTC: Create or update peer connections when participants change
  useEffect(() => {
    if (!user || !socketConnected || participants.length === 0) return;
    if (!socketRef.current || !socketRef.current.connected) {
      console.log('[RTC] Socket not connected, skipping PC creation');
      return;
    }
    
    const myId = user.userid;
    const otherParticipants = participants.filter(pid => pid !== myId);
    
    // Create peer connections for new participants
    otherParticipants.forEach(remoteId => {
      let pc = peersRef.current.get(remoteId);
      
      // Create new PC if needed or if closed
      if (!pc || pc.connectionState === 'closed') {
        console.log(`[RTC] Creating PC for ${remoteId}`);
        pc = createPeerConnection();
        peersRef.current.set(remoteId, pc);
        
        // Add local tracks if available
        if (localStream) {
          addTracksToPeerConnection(pc, localStream);
        }
        
        // Handle remote tracks
        pc.ontrack = (event) => {
          const stream = event.streams[0];
          if (stream) {
            console.log(`[RTC] Received remote track from ${remoteId} audioTracks=${stream.getAudioTracks().length} videoTracks=${stream.getVideoTracks().length}`);
            setRemoteStreams(prev => {
              const next = new Map(prev);
              next.set(remoteId, stream);
              return next;
            });
            
            // Attach to video element
            const videoRef = remoteVideoRefs.current.get(remoteId);
            if (videoRef && videoRef.current) {
              videoRef.current.srcObject = stream;
              videoRef.current.play().catch(err => {
                console.warn(`[RTC] Autoplay blocked for ${remoteId}, user interaction required`);
              });
            } else {
              console.log(`[RTC] Video ref not ready yet for ${remoteId}, will attach when available`);
            }
          }
        };
        
        // Handle ICE candidates
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            if (socketRef.current && socketRef.current.connected) {
              console.log(`[SIGNAL] Sending CANDIDATE to ${remoteId}`);
              socketRef.current.emit('media-candidate', {
                to: remoteId,
                from: myId,
                candidate: event.candidate
              });
            } else {
              console.warn(`[RTC] Socket not connected, queueing candidate for ${remoteId}`);
              // Queue candidate if socket not ready
              if (!pendingCandidatesRef.current.has(remoteId)) {
                pendingCandidatesRef.current.set(remoteId, []);
              }
              pendingCandidatesRef.current.get(remoteId).push(event.candidate);
            }
          }
        };
        
        // Handle connection state changes
        pc.onconnectionstatechange = () => {
          console.log(`[RTC] PC for ${remoteId} state: ${pc.connectionState}`);
          if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            // Cleanup
            setRemoteStreams(prev => {
              const next = new Map(prev);
              next.delete(remoteId);
              return next;
            });
          }
        };
        
        // Apply pending candidates
        const pendingCandidates = pendingCandidatesRef.current.get(remoteId);
        if (pendingCandidates) {
          pendingCandidates.forEach(candidate => {
            pc.addIceCandidate(candidate).catch(err => {
              console.warn(`[RTC] Failed to add pending candidate for ${remoteId}:`, err);
            });
          });
          pendingCandidatesRef.current.delete(remoteId);
        }
        
        // Create offer if lexicographically smaller (with debounce to avoid races)
        // Only set timeout if one doesn't already exist (to avoid duplicate timeouts on re-renders)
        if (!offerTimeoutRef.current.has(remoteId)) {
          console.log(`[RTC] Setting up offer timeout for ${remoteId} (myId=${myId}, remoteId=${remoteId}, shouldOffer=${myId < remoteId})`);
          const timeoutId = setTimeout(async () => {
            console.log(`[RTC] Offer timeout fired for ${remoteId}`);
            // Clear the timeout from the map since it's executing
            offerTimeoutRef.current.delete(remoteId);
            
            // Check if PC still exists and is in stable state
            const currentPc = peersRef.current.get(remoteId);
            if (!currentPc || currentPc !== pc) {
              console.log(`[RTC] Skipping offer to ${remoteId} - PC changed or removed`);
              return;
            }
            
            if (currentPc.signalingState !== 'stable') {
              console.log(`[RTC] Skipping offer to ${remoteId} - PC signaling state: ${currentPc.signalingState}`);
              return;
            }
            
            // Check if socket is connected
            if (!socketRef.current) {
              console.log(`[RTC] Skipping offer to ${remoteId} - socketRef is null`);
              return;
            }
            
            if (!socketRef.current.connected) {
              console.log(`[RTC] Skipping offer to ${remoteId} - socket not connected (state: ${socketRef.current.connected})`);
              return;
            }
            
            if (myId < remoteId) {
              try {
                console.log(`[SIGNAL] Sending OFFER to ${remoteId}`);
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                
                if (socketRef.current && socketRef.current.connected) {
                  socketRef.current.emit('media-offer', {
                    to: remoteId,
                    from: myId,
                    offer: offer
                  });
                  console.log(`[SIGNAL] OFFER sent successfully to ${remoteId}`);
                } else {
                  console.error(`[RTC] Socket not connected when trying to send offer to ${remoteId}`);
                }
              } catch (err) {
                console.error(`[RTC] Failed to create offer for ${remoteId}:`, err);
              }
            } else {
              console.log(`[RTC] Waiting for ${remoteId} to create offer (${myId} > ${remoteId})`);
            }
          }, 700); // 700ms debounce
          
          offerTimeoutRef.current.set(remoteId, timeoutId);
        } else {
          console.log(`[RTC] Offer timeout already exists for ${remoteId}, skipping`);
        }
      }
    });
    
    // Cleanup removed participants
    const currentPeerIds = new Set(otherParticipants);
    peersRef.current.forEach((pc, userId) => {
      if (!currentPeerIds.has(userId)) {
        console.log(`[RTC] Closing PC for ${userId}`);
        pc.close();
        peersRef.current.delete(userId);
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.delete(userId);
          return next;
        });
        pendingCandidatesRef.current.delete(userId);
        const timeoutId = offerTimeoutRef.current.get(userId);
        if (timeoutId) {
          clearTimeout(timeoutId);
          offerTimeoutRef.current.delete(userId);
        }
      }
    });
    
    return () => {
      // Cleanup is handled in the participants loop above
      // Only clear timeouts if component unmounts (which shouldn't happen during normal operation)
      // The cleanup above already handles removing timeouts for removed participants
    };
  }, [participants, user, localStream, socketConnected]);

  useEffect(() => {
    if (!user) return; // connect ASAP; don't wait for room fetch
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      path: '/socket.io',
    });
    socketRef.current = socket;
    
    socket.on('connect', () => {
      console.log('[SOCKET] connected', socket.id);
      setSocketConnected(true);
      socket.emit('join-room', { roomid, userid: user.userid });
      socket.emit('get-waiting-list', { roomid });
    });
    
    socket.on('disconnect', () => {
      console.log('[SOCKET] disconnected');
      setSocketConnected(false);
    });
    
    socket.on('participants-update', ({ participants: p, createdBy, hostActive: ha }) => {
      setParticipants(p || []);
      if (ha !== undefined) setHostActive(ha);
      if (createdBy && createdBy !== hostUserId) {
        setHostUserId(createdBy);
        getUserById(createdBy).then(setHostUserInfo).catch(console.warn);
      }
      console.log('[RoomPage] Got participants-update', p);
    });
    
    socket.on('host-left', ({ message }) => {
      // Host left locked room - redirect all participants
      if (!isHost && room?.locked) {
        alert(message || 'Host has left the meeting. You will be redirected.');
        setRoute('/home');
      }
    });
    
    socket.on('waiting-update', ({ waitingParticipants }) => {
      setWaiting(waitingParticipants || []);
      console.log('[RoomPage] Got waiting-update', waitingParticipants);
    });
    
    socket.on('participant-approved', ({ roomid: evtRoom, userid: evtUser, approve }) => {
      // Refresh lists if this user is the host
      if (isHost && evtRoom === roomid) {
        socket.emit('get-waiting-list', { roomid });
      }
      // If current user is approved in another window, redirect
      if (evtUser === user.userid && approve && window.location.pathname.includes('/lobby')) {
        setRoute(`/room/${roomid}`);
      }
    });
    
    // WebRTC signaling handlers
    socket.on('media-offer', async ({ from, offer }) => {
      console.log(`[SIGNAL] Received OFFER from ${from}`);
      const myId = user.userid;
      let pc = peersRef.current.get(from);
      
      if (!pc || pc.connectionState === 'closed') {
        console.log(`[RTC] Creating PC for ${from} (from offer)`);
        pc = createPeerConnection();
        peersRef.current.set(from, pc);
        
        // Add local tracks
        if (localStream) {
          addTracksToPeerConnection(pc, localStream);
        }
        
        // Setup handlers
        pc.ontrack = (event) => {
          const stream = event.streams[0];
          if (stream) {
            console.log(`[RTC] Received remote track from ${from} audioTracks=${stream.getAudioTracks().length} videoTracks=${stream.getVideoTracks().length}`);
            setRemoteStreams(prev => {
              const next = new Map(prev);
              next.set(from, stream);
              return next;
            });
            
            const videoRef = remoteVideoRefs.current.get(from);
            if (videoRef && videoRef.current) {
              videoRef.current.srcObject = stream;
              videoRef.current.play().catch(err => {
                console.warn(`[RTC] Autoplay blocked for ${from}, user interaction required`);
              });
            }
          }
        };
        
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            if (socket.connected) {
              console.log(`[SIGNAL] Sending CANDIDATE to ${from}`);
              socket.emit('media-candidate', {
                to: from,
                from: myId,
                candidate: event.candidate
              });
            } else {
              console.warn(`[RTC] Socket not connected, queueing candidate for ${from}`);
              if (!pendingCandidatesRef.current.has(from)) {
                pendingCandidatesRef.current.set(from, []);
              }
              pendingCandidatesRef.current.get(from).push(event.candidate);
            }
          }
        };
        
        pc.onconnectionstatechange = () => {
          console.log(`[RTC] PC for ${from} state: ${pc.connectionState}`);
          if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            setRemoteStreams(prev => {
              const next = new Map(prev);
              next.delete(from);
              return next;
            });
          }
        };
        
        // Apply pending candidates
        const pendingCandidates = pendingCandidatesRef.current.get(from);
        if (pendingCandidates) {
          pendingCandidates.forEach(candidate => {
            pc.addIceCandidate(candidate).catch(err => {
              console.warn(`[RTC] Failed to add pending candidate for ${from}:`, err);
            });
          });
          pendingCandidatesRef.current.delete(from);
        }
      }
      
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        console.log(`[RTC] Set remote description from ${from} (from offer)`);
        
        // Apply pending candidates after setting remote description
        const pendingCandidates = pendingCandidatesRef.current.get(from);
        if (pendingCandidates && pendingCandidates.length > 0) {
          console.log(`[RTC] Applying ${pendingCandidates.length} pending candidates for ${from} after offer`);
          pendingCandidates.forEach(candidate => {
            pc.addIceCandidate(candidate).catch(err => {
              console.warn(`[RTC] Failed to add pending candidate for ${from}:`, err);
            });
          });
          pendingCandidatesRef.current.delete(from);
        }
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log(`[SIGNAL] Sending ANSWER to ${from}`);
        if (socket.connected) {
          socket.emit('media-answer', {
            to: from,
            from: myId,
            answer: answer
          });
        } else {
          console.error(`[RTC] Socket not connected when trying to send answer to ${from}`);
        }
      } catch (err) {
        console.error(`[RTC] Failed to handle offer from ${from}:`, err);
      }
    });
    
    socket.on('media-answer', async ({ from, answer }) => {
      console.log(`[SIGNAL] Received ANSWER from ${from}`);
      const pc = peersRef.current.get(from);
      if (pc) {
        try {
          if (pc.signalingState !== 'stable') {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            console.log(`[RTC] Set remote description from ${from}`);
            
            // Apply pending candidates after setting remote description
            const pendingCandidates = pendingCandidatesRef.current.get(from);
            if (pendingCandidates && pendingCandidates.length > 0) {
              console.log(`[RTC] Applying ${pendingCandidates.length} pending candidates for ${from} after answer`);
              pendingCandidates.forEach(candidate => {
                pc.addIceCandidate(candidate).catch(err => {
                  console.warn(`[RTC] Failed to add pending candidate for ${from}:`, err);
                });
              });
              pendingCandidatesRef.current.delete(from);
            }
          } else {
            console.warn(`[RTC] PC for ${from} is in stable state, ignoring answer`);
          }
        } catch (err) {
          console.error(`[RTC] Failed to set remote description from ${from}:`, err);
        }
      } else {
        // Create PC if it doesn't exist
        console.log(`[RTC] Creating PC for ${from} (from answer)`);
        const newPc = createPeerConnection();
        peersRef.current.set(from, newPc);
        
        if (localStream) {
          addTracksToPeerConnection(newPc, localStream);
        }
        
        newPc.ontrack = (event) => {
          const stream = event.streams[0];
          if (stream) {
            console.log(`[RTC] Received remote track from ${from} audioTracks=${stream.getAudioTracks().length} videoTracks=${stream.getVideoTracks().length}`);
            setRemoteStreams(prev => {
              const next = new Map(prev);
              next.set(from, stream);
              return next;
            });
            
            const videoRef = remoteVideoRefs.current.get(from);
            if (videoRef && videoRef.current) {
              videoRef.current.srcObject = stream;
              videoRef.current.play().catch(err => {
                console.warn(`[RTC] Autoplay blocked for ${from}, user interaction required`);
              });
            }
          }
        };
        
        newPc.onicecandidate = (event) => {
          if (event.candidate) {
            if (socket.connected) {
              console.log(`[SIGNAL] Sending CANDIDATE to ${from}`);
              socket.emit('media-candidate', {
                to: from,
                from: myId,
                candidate: event.candidate
              });
            } else {
              console.warn(`[RTC] Socket not connected, queueing candidate for ${from}`);
              if (!pendingCandidatesRef.current.has(from)) {
                pendingCandidatesRef.current.set(from, []);
              }
              pendingCandidatesRef.current.get(from).push(event.candidate);
            }
          }
        };
        
        try {
          await newPc.setRemoteDescription(new RTCSessionDescription(answer));
          console.log(`[RTC] Set remote description from ${from} (new PC)`);
          
          // Apply pending candidates after setting remote description
          const pendingCandidates = pendingCandidatesRef.current.get(from);
          if (pendingCandidates && pendingCandidates.length > 0) {
            console.log(`[RTC] Applying ${pendingCandidates.length} pending candidates for ${from} after answer (new PC)`);
            pendingCandidates.forEach(candidate => {
              newPc.addIceCandidate(candidate).catch(err => {
                console.warn(`[RTC] Failed to add pending candidate for ${from}:`, err);
              });
            });
            pendingCandidatesRef.current.delete(from);
          }
        } catch (err) {
          console.error(`[RTC] Failed to set remote description from ${from}:`, err);
        }
      }
    });
    
    socket.on('media-candidate', async ({ from, candidate }) => {
      console.log(`[SIGNAL] Received CANDIDATE from ${from}`);
      const pc = peersRef.current.get(from);
      if (pc) {
        // Try to add candidate - it will work even if remoteDescription isn't set yet
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          console.log(`[RTC] Successfully added ICE candidate from ${from}`);
        } catch (err) {
          // If it fails, queue it for later
          console.log(`[Signal buffer] Queuing CANDIDATE for ${from} (PC not ready or error: ${err.message})`);
          if (!pendingCandidatesRef.current.has(from)) {
            pendingCandidatesRef.current.set(from, []);
          }
          pendingCandidatesRef.current.get(from).push(new RTCIceCandidate(candidate));
        }
      } else {
        // Queue candidate for later
        console.log(`[Signal buffer] Queuing CANDIDATE for ${from} (PC not created yet)`);
        if (!pendingCandidatesRef.current.has(from)) {
          pendingCandidatesRef.current.set(from, []);
        }
        pendingCandidatesRef.current.get(from).push(new RTCIceCandidate(candidate));
      }
    });
    
    socket.on('media-toggle', ({ userid, micEnabled, cameraEnabled }) => {
      console.log(`[SIGNAL] Received media-toggle from ${userid} mic=${micEnabled} camera=${cameraEnabled}`);
      setMediaStates(prev => {
        const next = new Map(prev);
        next.set(userid, { micEnabled, cameraEnabled });
        return next;
      });
    });
    
    // Handle browser back/close/tab close
    const handleBeforeUnload = () => {
      if (socketRef.current) {
        socketRef.current.emit('leave-room');
      }
      // Stop all tracks
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      // Close all peer connections
      peersRef.current.forEach(pc => pc.close());
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Do not emit leave-room on normal re-renders; only disconnect socket
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      // Do not stop media or close PCs here; they should persist across re-renders
    };
    // eslint-disable-next-line
  }, [user, roomid]);

  // Initialize video refs for remote participants
  useEffect(() => {
    participants.forEach(userId => {
      if (userId !== user?.userid && !remoteVideoRefs.current.has(userId)) {
        remoteVideoRefs.current.set(userId, { current: null });
      }
    });
    
    // Cleanup refs for removed participants
    const currentParticipantIds = new Set(participants);
    remoteVideoRefs.current.forEach((ref, userId) => {
      if (!currentParticipantIds.has(userId)) {
        remoteVideoRefs.current.delete(userId);
      }
    });
  }, [participants, user]);
  
  // Attach local stream to video element
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);
  
  // Set up audio level detection for local stream
  useEffect(() => {
    if (localStream && localMicEnabled) {
      const audioTracks = localStream.getAudioTracks();
      if (audioTracks.length > 0 && audioTracks[0].enabled) {
        const existing = audioAnalyzersRef.current.get('local');
        if (existing) {
          if (existing.animationFrame) {
            cancelAnimationFrame(existing.animationFrame);
          }
          if (existing.audioContext) {
            existing.audioContext.close().catch(() => {});
          }
        }
        
        try {
          const audioContext = new (window.AudioContext || window.webkitAudioContext)();
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.8;
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          
          const source = audioContext.createMediaStreamSource(localStream);
          source.connect(analyser);
          
          const checkAudioLevel = () => {
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;
            const threshold = 30;
            
            setSpeakingUsers(prev => {
              const next = new Set(prev);
              if (average > threshold && user?.userid) {
                next.add(user.userid);
              } else if (user?.userid) {
                next.delete(user.userid);
              }
              return next;
            });
            
            const animationFrame = requestAnimationFrame(checkAudioLevel);
            audioAnalyzersRef.current.set('local', { analyser, dataArray, animationFrame, audioContext });
          };
          
          checkAudioLevel();
        } catch (err) {
          console.error(`[AUDIO] Failed to create analyzer for local:`, err);
        }
      } else {
        setSpeakingUsers(prev => {
          const next = new Set(prev);
          if (user?.userid) next.delete(user.userid);
          return next;
        });
        
        const existing = audioAnalyzersRef.current.get('local');
        if (existing) {
          if (existing.animationFrame) {
            cancelAnimationFrame(existing.animationFrame);
          }
          if (existing.audioContext) {
            existing.audioContext.close().catch(() => {});
          }
          audioAnalyzersRef.current.delete('local');
        }
      }
    }
    
    return () => {
      const existing = audioAnalyzersRef.current.get('local');
      if (existing) {
        if (existing.animationFrame) {
          cancelAnimationFrame(existing.animationFrame);
        }
        if (existing.audioContext) {
          existing.audioContext.close().catch(() => {});
        }
        audioAnalyzersRef.current.delete('local');
      }
    };
  }, [localStream, localMicEnabled, user?.userid]);

  // Attach remote streams to video elements and set up audio level detection
  useEffect(() => {
    remoteStreams.forEach((stream, userId) => {
      const videoRef = remoteVideoRefs.current.get(userId);
      if (videoRef && videoRef.current && videoRef.current.srcObject !== stream) {
        console.log(`[RTC] Attaching stream to video element for ${userId}`);
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(err => {
          console.warn(`[RTC] Autoplay blocked for ${userId}, user interaction required`);
        });
      }
      
      // Set up audio level detection for speaking indicator
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0 && audioTracks[0].enabled) {
        // Clean up existing analyzer if any
        const existing = audioAnalyzersRef.current.get(userId);
        if (existing) {
          if (existing.animationFrame) {
            cancelAnimationFrame(existing.animationFrame);
          }
          if (existing.audioContext) {
            existing.audioContext.close().catch(() => {});
          }
        }
        
        try {
          const audioContext = new (window.AudioContext || window.webkitAudioContext)();
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.8;
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          
          const source = audioContext.createMediaStreamSource(stream);
          source.connect(analyser);
          
          const checkAudioLevel = () => {
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;
            const threshold = 30; // Adjust this threshold as needed
            
            setSpeakingUsers(prev => {
              const next = new Set(prev);
              if (average > threshold) {
                next.add(userId);
              } else {
                next.delete(userId);
              }
              return next;
            });
            
            const animationFrame = requestAnimationFrame(checkAudioLevel);
            audioAnalyzersRef.current.set(userId, { analyser, dataArray, animationFrame, audioContext });
          };
          
          checkAudioLevel();
        } catch (err) {
          console.error(`[AUDIO] Failed to create analyzer for ${userId}:`, err);
        }
      } else {
        // Remove from speaking users if no audio track
        setSpeakingUsers(prev => {
          const next = new Set(prev);
          next.delete(userId);
          return next;
        });
        
        // Clean up analyzer
        const existing = audioAnalyzersRef.current.get(userId);
        if (existing) {
          if (existing.animationFrame) {
            cancelAnimationFrame(existing.animationFrame);
          }
          if (existing.audioContext) {
            existing.audioContext.close().catch(() => {});
          }
          audioAnalyzersRef.current.delete(userId);
        }
      }
    });
    
    // Cleanup function - remove users who no longer have streams
    const currentUserIds = new Set(remoteStreams.keys());
    setSpeakingUsers(prev => {
      const next = new Set(prev);
      prev.forEach(userId => {
        if (!currentUserIds.has(userId)) {
          next.delete(userId);
        }
      });
      return next;
    });
    
    audioAnalyzersRef.current.forEach((value, userId) => {
      if (!currentUserIds.has(userId)) {
        if (value.animationFrame) {
          cancelAnimationFrame(value.animationFrame);
        }
        if (value.audioContext) {
          value.audioContext.close().catch(() => {});
        }
        audioAnalyzersRef.current.delete(userId);
      }
    });
  }, [remoteStreams]);

  // Media toggle handlers
  const toggleMic = () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      const newState = audioTrack.enabled;
      setLocalMicEnabled(newState);
      console.log(`[MEDIA] Toggled mic => ${newState}`);
      
      if (socketRef.current) {
        socketRef.current.emit('media-toggle', {
          roomid,
          userid: user.userid,
          micEnabled: newState,
          cameraEnabled: localCameraEnabled
        });
      }
    }
  };
  
  const toggleCamera = () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      const newState = videoTrack.enabled;
      setLocalCameraEnabled(newState);
      console.log(`[MEDIA] Toggled camera => ${newState}`);
      
      if (socketRef.current) {
        socketRef.current.emit('media-toggle', {
          roomid,
          userid: user.userid,
          micEnabled: localMicEnabled,
          cameraEnabled: newState
        });
      }
    }
  };
  
  const retryMedia = async () => {
    setMediaError(null);
    try {
      let newStream = null;
      try {
        newStream = await getUserMediaCompat({ audio: true, video: true });
      } catch (err) {
        console.error('[MEDIA] Failed to get user media (audio+video):', err);
        if (err && (err.name === 'NotReadableError' || err.name === 'NotFoundError' || err.name === 'AbortError')) {
          try {
            newStream = await getUserMediaCompat({ audio: true, video: false });
            console.log('[MEDIA] Retry fallback to audio-only (camera unavailable)');
          } catch (err2) {
            console.error('[MEDIA] Fallback audio-only failed:', err2);
            setMediaError(err2.message || 'Failed to access microphone');
            return;
          }
        } else {
          setMediaError(err.message || 'Failed to access camera/microphone');
          return;
        }
      }

      setLocalStream(newStream);
      const counts = getTrackCounts(newStream);
      console.log(`[MEDIA] Local tracks audio=${counts.audio} video=${counts.video}`);
      
      const micEnabled = newStream.getAudioTracks()[0]?.enabled ?? true;
      const cameraEnabled = newStream.getVideoTracks()[0]?.enabled ?? false;
      setLocalMicEnabled(micEnabled);
      setLocalCameraEnabled(cameraEnabled);
      
      // Inform others of current state
      if (socketRef.current && user) {
        socketRef.current.emit('media-toggle', {
          roomid,
          userid: user.userid,
          micEnabled,
          cameraEnabled
        });
      }
      
      // Add tracks to all existing peer connections
      peersRef.current.forEach((pc, userId) => {
        if (pc.connectionState !== 'closed') {
          addTracksToPeerConnection(pc, newStream);
        }
      });
    } catch (err) {
      console.error('[MEDIA] Failed to get user media:', err);
      setMediaError(err.message || 'Failed to access camera/microphone');
    }
  };

  // Host approve/reject handlers
  const handleApprove = (userid) => {
    if (!socketRef.current) return;
    socketRef.current.emit('host-approve', { roomid, userid, approve: true });
  };
  const handleReject = (userid) => {
    if (!socketRef.current) return;
    socketRef.current.emit('host-approve', { roomid, userid, approve: false });
  };
  
  // Enable audio for remote video (for autoplay policy)
  const enableRemoteAudio = (userId) => {
    const videoRef = remoteVideoRefs.current.get(userId);
    if (videoRef && videoRef.current) {
      videoRef.current.muted = false;
      videoRef.current.play().catch(err => {
        console.warn(`[RTC] Failed to play audio for ${userId}:`, err);
      });
    }
  };

  if (!user || !room) return null;
  
  const allParticipants = participants.length > 0 ? participants : (user ? [user.userid] : []);
  const totalVideoCount = allParticipants.length;
  
  // Calculate optimal grid columns based on number of participants and screen size
  const calculateGridColumns = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    if (totalVideoCount === 1) {
      // Single video: make it bigger but responsive - will be overridden by CSS
      return '1fr';
    }
    
    // Multiple videos: create symmetric grid based on count
    // For 2 videos: 2 columns
    if (totalVideoCount === 2) return 'repeat(2, 1fr)';
    
    // For 3 videos: 3 columns
    if (totalVideoCount === 3) return 'repeat(3, 1fr)';
    
    // For 4 videos: 2x2 grid
    if (totalVideoCount === 4) return 'repeat(2, 1fr)';
    
    // For 5-6 videos: 3 columns
    if (totalVideoCount === 5 || totalVideoCount === 6) return 'repeat(3, 1fr)';
    
    // For 7-9 videos: 3 columns
    if (totalVideoCount >= 7 && totalVideoCount <= 9) return 'repeat(3, 1fr)';
    
    // For 10-12 videos: 4 columns
    if (totalVideoCount >= 10 && totalVideoCount <= 12) return 'repeat(4, 1fr)';
    
    // For 13-16 videos: 4 columns
    if (totalVideoCount >= 13 && totalVideoCount <= 16) return 'repeat(4, 1fr)';
    
    // For more than 16, use auto-fill with responsive minmax
    // This will be overridden by media queries for smaller screens
    const minTileWidth = width >= 1920 ? 250 : width >= 1400 ? 220 : width >= 1024 ? 200 : width >= 768 ? 180 : 150;
    return `repeat(auto-fill, minmax(${minTileWidth}px, 1fr))`;
  };
  
  const gridStyle = {
    gridTemplateColumns: calculateGridColumns()
  };

  // Helper function to get user initials
  const getUserInitials = (fullname, username) => {
    if (fullname) {
      const parts = fullname.trim().split(/\s+/);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      } else if (parts[0].length >= 2) {
        return parts[0].substring(0, 2).toUpperCase();
      }
      return parts[0][0].toUpperCase();
    }
    if (username && username.length >= 2) {
      return username.substring(0, 2).toUpperCase();
    }
    return '??';
  };

  // Helper function to get avatar URL from email using Gravatar
  const getAvatarFromEmail = (email) => {
    if (!email) return null;
    
    try {
      // Use Gravatar with MD5 hash of email
      const emailLower = email.toLowerCase().trim();
      const emailHash = CryptoJS.MD5(emailLower).toString();
      return `https://www.gravatar.com/avatar/${emailHash}?d=404&s=200`;
    } catch (err) {
      console.error('[AVATAR] Error generating Gravatar URL:', err);
      return null;
    }
  };

  // Helper function to get avatar URL with fallback
  const getAvatarUrl = (user) => {
    // First check if avatar/profilePicture is already set
    if (user?.avatar) return user.avatar;
    if (user?.profilePicture) return user.profilePicture;
    
    // Try to get from email using Gravatar
    if (user?.email) {
      return getAvatarFromEmail(user.email);
    }
    
    return null;
  };

  // Get sidebar width for padding calculation
  const sidebarWidth = participantsCollapsed ? 48 : 240;
  
  return (
    <div className="roomPage">
      <div 
        className="roomParent"
        style={{
          gridTemplateColumns: 'repeat(4, 1fr)'
        }}
      >
        {/* Div 1: Room Info */}
        <div className="roomInfoCard">
          <div className="welcomeLine">
            Welcome, {user.fullname || user.username}! {isHost && <span className="hostBadge">(Host)</span>}
        </div>
          <div className="roomInfoLine">
            <span className="roomIdLabel">Room ID:- </span>
            <span className="roomId">{roomid}</span>
            <span className="roomDivider">|</span>
            <span className={`roomLockStatus ${room.locked ? 'locked' : 'open'}`}>
              {room.locked ? 'Locked' : 'Open'}
            </span>
          </div>
        </div>

        {/* Div 2: Video Feeds */}
        <div className="videoFeedsCard">
      {/* Media error retry UI */}
      {mediaError && (
            <div className="errorContainer">
              <div className="errorMsg">{mediaError}</div>
              <button onClick={retryMedia} className="retryBtn">Retry Camera/Mic</button>
        </div>
      )}
      
          <div className="videoContainer">
            <div 
              className="videoGrid" 
              style={{
                ...gridStyle,
                maxWidth: `calc(100% - ${sidebarWidth + 16}px)` // Prevent overlap with sidebar
              }} 
              data-single-video={totalVideoCount === 1 ? "true" : "false"}
            >
        {/* Local video */}
              <div className={`videoTile ${localMicEnabled && speakingUsers.has(user?.userid) ? (localCameraEnabled ? 'speaking' : 'speaking-avatar') : ''}`}>
                {localStream && localCameraEnabled && localStream.getVideoTracks().some(track => track.enabled) ? (
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
                    className="video"
                  />
                ) : (
                  <div className="avatarPlaceholder">
                    {(() => {
                      const avatarUrl = getAvatarUrl(user);
                      return avatarUrl ? (
                        <img 
                          src={avatarUrl} 
                          alt={user?.fullname || user?.username}
                          className="avatarImage"
                          onError={(e) => {
                            // Fallback to initials if image fails to load
                            e.target.style.display = 'none';
                            const parent = e.target.parentElement;
                            if (parent && !parent.querySelector('.avatarInitials')) {
                              const initialsDiv = document.createElement('div');
                              initialsDiv.className = 'avatarInitials';
                              initialsDiv.textContent = getUserInitials(user?.fullname, user?.username);
                              parent.appendChild(initialsDiv);
                            }
                          }}
                          onLoad={(e) => {
                            // Ensure image is visible when loaded
                            e.target.style.display = 'block';
                          }}
          />
                      ) : (
                        <div className="avatarInitials">
                          {getUserInitials(user?.fullname, user?.username)}
                        </div>
                      );
                    })()}
                  </div>
                )}
          {localStream && (
                  <div className="videoOverlay">
                    <div className="videoLabel">
                {user.fullname || user.username} {isHost && '(Host)'} (You)
              </div>
                    <div className="controls">
                <button
                  onClick={toggleMic}
                        className={localMicEnabled ? 'controlBtn' : 'controlBtn controlBtnOff'}
                  title={localMicEnabled ? 'Mute' : 'Unmute'}
                >
                        <img src={localMicEnabled ? micUnmutedIcon : micMutedIcon} alt={localMicEnabled ? 'Mic On' : 'Mic Off'} className="controlIcon" />
                </button>
                <button
                  onClick={toggleCamera}
                        className={localCameraEnabled ? 'controlBtn' : 'controlBtn controlBtnOff'}
                  title={localCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
                >
                        <img src={localCameraEnabled ? cameraOnIcon : cameraOffIcon} alt={localCameraEnabled ? 'Camera On' : 'Camera Off'} className="controlIcon" />
                </button>
              </div>
            </div>
          )}
          {!localStream && (
                  <div className="placeholder">
              <div>No camera/mic</div>
                    <button onClick={retryMedia} className="smallBtn">Enable</button>
            </div>
          )}
        </div>
        
        {/* Remote videos */}
              {allParticipants
                .filter(participantId => participantId !== user.userid)
                .slice(currentVideoPage * videosPerPage, (currentVideoPage + 1) * videosPerPage)
                .map(participantId => {
          const remoteStream = remoteStreams.get(participantId);
          const participantUser = participantUsers.get(participantId) || { userid: participantId, username: participantId, fullname: participantId };
          const mediaState = mediaStates.get(participantId) || { micEnabled: true, cameraEnabled: true };
          const isHostUser = participantId === hostUserId;
                  
                  const isSpeaking = speakingUsers.has(participantId) && mediaState.micEnabled;
          
          return (
                    <div 
                      key={participantId} 
                      className={`videoTile ${isSpeaking ? (mediaState.cameraEnabled ? 'speaking' : 'speaking-avatar') : ''}`}
                    >
              {remoteStream ? (
                <>
                          {mediaState.cameraEnabled ? (
                  <video
                    ref={el => {
                      const ref = remoteVideoRefs.current.get(participantId);
                      if (ref) ref.current = el;
                    }}
                    autoPlay
                    playsInline
                              className="video"
                            />
                          ) : (
                            <div className="avatarPlaceholder">
                              {(() => {
                                const avatarUrl = getAvatarUrl(participantUser);
                                return avatarUrl ? (
                                  <img 
                                    src={avatarUrl} 
                                    alt={participantUser.fullname || participantUser.username}
                                    className="avatarImage"
                                    onError={(e) => {
                                      // Fallback to initials if image fails to load
                                      e.target.style.display = 'none';
                                      const parent = e.target.parentElement;
                                      if (parent && !parent.querySelector('.avatarInitials')) {
                                        const initialsDiv = document.createElement('div');
                                        initialsDiv.className = 'avatarInitials';
                                        initialsDiv.textContent = getUserInitials(participantUser.fullname, participantUser.username);
                                        parent.appendChild(initialsDiv);
                                      }
                                    }}
                                    onLoad={(e) => {
                                      // Hide gradient background when image loads successfully
                                      e.target.style.display = 'block';
                                    }}
                  />
                                ) : (
                                  <div className="avatarInitials">
                                    {getUserInitials(participantUser.fullname, participantUser.username)}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                          <div className="videoOverlay">
                            <div className="videoLabel">
                      {participantUser.fullname || participantUser.username || participantId}
                      {isHostUser && ' (Host)'}
                    </div>
                  </div>
                  {/* Check if audio might be muted due to autoplay */}
                  {remoteStream.getAudioTracks().length > 0 && (
                    <button
                      onClick={() => enableRemoteAudio(participantId)}
                              className="enableAudioBtn"
                      title="Click to enable audio"
                    >
                      🔊 Enable Sound
                    </button>
                  )}
                </>
              ) : (
                        <div className={`avatarPlaceholder ${isSpeaking ? 'speaking-avatar' : ''}`}>
                          {(() => {
                            const avatarUrl = getAvatarUrl(participantUser);
                            return avatarUrl ? (
                              <img 
                                src={avatarUrl} 
                                alt={participantUser.fullname || participantUser.username}
                                className="avatarImage"
                                onError={(e) => {
                                  // Fallback to initials if image fails to load
                                  e.target.style.display = 'none';
                                  const parent = e.target.parentElement;
                                  if (parent && !parent.querySelector('.avatarInitials')) {
                                    const initialsDiv = document.createElement('div');
                                    initialsDiv.className = 'avatarInitials';
                                    initialsDiv.textContent = getUserInitials(participantUser.fullname, participantUser.username);
                                    parent.appendChild(initialsDiv);
                                  }
                                }}
                                onLoad={(e) => {
                                  // Hide gradient background when image loads successfully
                                  e.target.style.display = 'block';
                                }}
                              />
                            ) : (
                              <div className="avatarInitials">
                                {getUserInitials(participantUser.fullname, participantUser.username)}
                              </div>
                            );
                          })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
      
            {/* Pagination controls */}
            {allParticipants.filter(p => p !== user.userid).length > videosPerPage && (
              <div className="videoPagination">
                <button
                  onClick={() => setCurrentVideoPage(prev => Math.max(0, prev - 1))}
                  disabled={currentVideoPage === 0}
                  className="paginationBtn"
                >
                  ← Prev
                </button>
                <span className="paginationInfo">
                  Page {currentVideoPage + 1} of {Math.ceil((allParticipants.filter(p => p !== user.userid).length) / videosPerPage)}
                </span>
                <button
                  onClick={() => setCurrentVideoPage(prev => Math.min(Math.ceil((allParticipants.filter(p => p !== user.userid).length) / videosPerPage) - 1, prev + 1))}
                  disabled={currentVideoPage >= Math.ceil((allParticipants.filter(p => p !== user.userid).length) / videosPerPage) - 1}
                  className="paginationBtn"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Div 3: Participants List / Chat Sidebar */}
        <div className={`participantsCard ${participantsCollapsed ? 'collapsed' : ''}`}>
          <div className="participantsHeaderRow">
            <button
              className="participantsToggleBtn"
              onClick={() => setParticipantsCollapsed(!participantsCollapsed)}
              title={participantsCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            >
              {participantsCollapsed ? '←' : '→'}
            </button>
            {participantsCollapsed ? (
              <p className="participantsHeader collapsed">
                ({participants.length})
              </p>
            ) : (
              <p className="participantsHeader">
                Participants ({participants.length})
              </p>
            )}
          </div>
          {!participantsCollapsed && (
            <>
              <div className="sidebarViewToggle">
                <button
                  className={`viewToggleBtn ${sidebarView === 'participants' ? 'active' : ''}`}
                  onClick={() => setSidebarView('participants')}
                >
                  Participants
                </button>
                <button
                  className={`viewToggleBtn ${sidebarView === 'chat' ? 'active' : ''}`}
                  onClick={() => setSidebarView('chat')}
                >
                  Chat
                </button>
              </div>
              <div className="participantsContainer">
                {sidebarView === 'participants' ? (
                  <>
                    <ul className="participantsList">
                      {participants
                        .slice(currentParticipantsPage * participantsPerPage, (currentParticipantsPage + 1) * participantsPerPage)
                        .map(uid => {
        const u = participantUsers.get(uid) || { userid: uid, username: uid, fullname: uid };
        const isHostUser = uid === hostUserId;
                          return (
                            <li key={uid} className="participantItem">
                              {uid === user.userid ? (
                                <b>You{isHost ? ' (host)' : ''}</b>
                              ) : (
                                <>
                                  {u.fullname || u.username || uid}
                                  {isHostUser && <span className="participantHostBadge">(Host)</span>}
                                </>
                              )}
                            </li>
                          );
                        })}
                    </ul>
                    
                    {/* Participants pagination */}
                    {participants.length > participantsPerPage && (
                      <div className="participantsPagination">
                        <button
                          onClick={() => setCurrentParticipantsPage(prev => Math.max(0, prev - 1))}
                          disabled={currentParticipantsPage === 0}
                          className="paginationBtn"
                        >
                          ← Prev
                        </button>
                        <span className="paginationInfo">
                          Page {currentParticipantsPage + 1} of {Math.ceil(participants.length / participantsPerPage)}
                        </span>
                        <button
                          onClick={() => setCurrentParticipantsPage(prev => Math.min(Math.ceil(participants.length / participantsPerPage) - 1, prev + 1))}
                          disabled={currentParticipantsPage >= Math.ceil(participants.length / participantsPerPage) - 1}
                          className="paginationBtn"
                        >
                          Next →
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="chatContainer">
                    <div className="chatPlaceholder">
                      Chat feature coming soon...
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Div 4: Waiting for Approval */}
      {isHost && room.locked && (
          <div className="waitingCard">
            <div className="waitingHeaderRow">
              <p className="waitingHeader">
                Waiting for approval <span>({waiting.length})</span>
              </p>
              <span className="waitingDivider">|</span>
              <button
                className="backButton"
                onClick={() => {
                  // Emit leave-room before navigating
                  if (socketRef.current) {
                    socketRef.current.emit('leave-room');
                    socketRef.current.disconnect();
                  }
                  // Stop media
                  if (localStream) {
                    localStream.getTracks().forEach(track => track.stop());
                  }
                  // Close peer connections
                  peersRef.current.forEach(pc => pc.close());
                  window.location.href = '/home';
                }}
              >
                Back to Home
              </button>
            </div>
            {waiting.length === 0 ? (
              <div className="noWaiting">No pending join requests.</div>
            ) : (
              <ul className="waitingList">
              {waiting.map(uid => {
                const u = waitingUsers.get(uid) || { userid: uid, username: uid, fullname: uid };
                return (
                    <li key={uid} className="waitingItem">
                      <span className="waitingItemName">{u.fullname || u.username || uid}</span>
                      <div className="waitingButtons">
                        <button onClick={() => handleApprove(uid)} className="approveBtn">Approve</button>
                        <button onClick={() => handleReject(uid)} className="rejectBtn">Reject</button>
                      </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
        
        {/* Back button for non-host or non-locked rooms */}
        {(!isHost || !room.locked) && (
          <div className="waitingCard">
            <div className="waitingHeaderRow">
              <p className="waitingHeader" style={{ margin: 0, visibility: 'hidden' }}>
                Waiting for approval <span>(0)</span>
              </p>
              <span className="waitingDivider" style={{ visibility: 'hidden' }}>|</span>
              <button
                className="backButton"
                onClick={() => {
        // Emit leave-room before navigating
        if (socketRef.current) {
          socketRef.current.emit('leave-room');
          socketRef.current.disconnect();
        }
        // Stop media
        if (localStream) {
          localStream.getTracks().forEach(track => track.stop());
        }
        // Close peer connections
        peersRef.current.forEach(pc => pc.close());
        window.location.href = '/home';
                }}
              >
                Back to Home
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

