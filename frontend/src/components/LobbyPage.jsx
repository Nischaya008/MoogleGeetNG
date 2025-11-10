import { useEffect, useRef, useState } from 'react';
import { getCurrentUser, getUserById } from '../api/auth';
import { fetchRoomById } from '../api/room';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_IO_URL || 'http://localhost:5000';

export default function LobbyPage({ roomid, setRoute }) {
  const [user, setUser] = useState(null);
  const [room, setRoom] = useState(null);
  const [waiting, setWaiting] = useState([]);
  const [waitingUsers, setWaitingUsers] = useState(new Map());
  const [participants, setParticipants] = useState([]);
  const [participantUsers, setParticipantUsers] = useState(new Map());
  const [hostUserId, setHostUserId] = useState(null);
  const [hostUserInfo, setHostUserInfo] = useState(null);
  const [rejected, setRejected] = useState(false);
  const approvedAndNavigatingRef = useRef(false);
  const socketRef = useRef(null);

  useEffect(() => {
    (async () => {
      const u = await getCurrentUser();
      if (!u) { window.location.href = '/enter'; return; }
      setUser(u);
      // Fetch room to check if it's actually locked
      try {
        const r = await fetchRoomById(roomid);
        setRoom(r);
        setHostUserId(r.createdBy);
        // Fetch host user info for display
        try {
          const hostInfo = await getUserById(r.createdBy);
          setHostUserInfo(hostInfo);
        } catch (e) {
          console.warn('Failed to fetch host info:', e);
        }
        // If room is open, redirect to room page (shouldn't be in lobby)
        if (!r.locked) {
          setRoute(`/room/${roomid}`);
          return;
        }
        // If user is host, they should never be in lobby
        if (r.createdBy === u.userid) {
          setRoute(`/room/${roomid}`);
          return;
        }
      } catch (e) {
        console.error('Failed to fetch room:', e);
      }
    })();
  }, [roomid, setRoute]);

  useEffect(() => {
    if (!user) return;
    // Connect with credentials
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      path: '/socket.io',
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[LobbyPage] Socket connected:', socket.id);
      socket.emit('join-room', { roomid, userid: user.userid });
      // Safety: always re-ask join (idempotent, backend dedupes)
      socket.emit('ask-join', { roomid, userid: user.userid });
    });
    socket.on('disconnect', () => {
      console.log('[LobbyPage] Socket disconnected');
    });
    socket.on('waiting-update', ({ waitingParticipants }) => {
      setWaiting(waitingParticipants || []);
      console.log('[LobbyPage] Got waiting-update', waitingParticipants);
    });
    socket.on('participants-update', ({ participants: p, createdBy, hostActive: ha }) => {
      setParticipants(p || []);
      if (createdBy && createdBy !== hostUserId) {
        setHostUserId(createdBy);
        getUserById(createdBy).then(setHostUserInfo).catch(console.warn);
      }
      console.log('[LobbyPage] Got participants-update', p);
    });
    socket.on('host-left', ({ message }) => {
      // Host left locked room - redirect waiting users
      alert(message || 'Host has left the meeting. You will be redirected.');
      setRoute('/home');
    });
    socket.on('participant-approved', ({ roomid: evtRoom, userid: evtUser, approve }) => {
      if (evtUser === user.userid) {
        if (approve) {
          // Set flag to prevent cleanup from emitting leave-room
          approvedAndNavigatingRef.current = true;
          // Small delay to ensure DB has been updated
          setTimeout(() => {
            setRoute(`/room/${roomid}`);
          }, 100);
        } else {
          setRejected(true);
        }
      }
    });
    // Handle browser back/close/tab close
    const handleBeforeUnload = () => {
      if (socketRef.current) {
        socketRef.current.emit('leave-room');
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (socketRef.current) {
        // If user was approved and is navigating to room, don't emit leave-room
        // This prevents removing them from participants when they're actually joining
        if (!approvedAndNavigatingRef.current) {
          socketRef.current.emit('leave-room');
        }
        socketRef.current.disconnect();
      }
    };
    // eslint-disable-next-line
  }, [user, roomid]);

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

  if (!user || !room) return null;
  if (rejected) {
    return <div style={outerS}><div style={rejectedS}>Sorry, your request was denied.<br /><button onClick={()=>setRoute('/home')} style={btnS}>Back to Home</button></div></div>;
  }
  return (
    <div style={outerS}>
      <div style={hdrS}>Waiting to join room <b>{roomid}</b>...</div>
      <div style={msgS}>A host must approve your request. Please wait.<br />Close this tab to cancel your request.</div>
      {hostUserInfo && (
        <div style={hostInfoS}>Host: <b>{hostUserInfo.fullname || hostUserInfo.username || hostUserId}</b></div>
      )}
      <div style={lstHdrS}>People waiting: {waiting.length}</div>
      <ul style={lstS}>{waiting.map(uid => {
        const u = waitingUsers.get(uid) || { userid: uid, username: uid, fullname: uid };
        return <li key={uid}>{uid === user.userid ? <b>You</b> : u.fullname || u.username || uid}</li>;
      })}</ul>
      <div style={lstHdrS}>Current participants ({participants.length}):</div>
      <ul style={lstS}>{participants.map(uid => {
        const u = participantUsers.get(uid) || { userid: uid, username: uid, fullname: uid };
        const isHostUser = uid === hostUserId;
        return <li key={uid}>{u.fullname || u.username || uid}{isHostUser && <span style={{color:'#1976d2', marginLeft:8}}>(Host)</span>}</li>;
      })}</ul>
    </div>
  );
}

const outerS = { minHeight:'100vh', background:'#f7fafc', padding:'56px 0', textAlign:'center'};
const hdrS = { fontSize:25, fontWeight:700, color:'#1976d2', marginBottom:28, letterSpacing:0.5 };
const msgS = { background:'#f8fdff', padding:'13px 16px', borderRadius:9, margin:'0 auto 14px auto', fontSize:15, color:'#19304e', display:'inline-block' };
const lstHdrS = { marginTop:17, fontWeight:600, fontSize:16, color:'#223c4e' };
const lstS = { listStyle:'none', padding:0, margin:'7px auto 12px auto', maxWidth:220 };
const rejectedS = { background:'#ffeaea', borderRadius:10, padding:'32px', marginTop:60, display:'inline-block', color:'#b1001a', fontSize:19, fontWeight:700 };
const btnS = { marginTop:14, borderRadius:6, background:'#1976d2', color:'#fff', padding:'10px 26px', border:'none', fontWeight:600, fontSize:16, cursor:'pointer'};
const hostInfoS = { margin:'12px auto', padding:'8px 14px', background:'#e3f2fd', borderRadius:8, fontSize:15, color:'#1565c0', fontWeight:600, display:'inline-block' };
