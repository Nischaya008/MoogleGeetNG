import { useState, useEffect } from 'react';
import { fetchRooms, createRoom, joinRoom } from '../api/room';
import { getCurrentUser, logout, getUserById } from '../api/auth';
import './HomePage.css';

export default function HomePage({ setRoute }) {
  const [rooms, setRooms] = useState([]);
  const [createModal, setCreateModal] = useState(false);
  const [joinRoomId, setJoinRoomId] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [user, setUser] = useState(null);
  const [locked, setLocked] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const u = await getCurrentUser();
        if (!u) {
          window.location.href = '/enter';
          return;
        }
        setUser(u);
      } catch(e) { setErr(e.message || 'Failed to fetch user.'); }
    })();
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (user) {
      loadRooms();
    }
    // eslint-disable-next-line
  }, [user]);

  async function loadRooms() {
    try { 
      const allRooms = await fetchRooms();
      if (!user) return;
      
      // Filter rooms: only show rooms where user is creator or participant
      const userRooms = allRooms.filter(r => 
        r.createdBy === user.userid || r.participants?.includes(user.userid)
      );
      
      // Sort by createdAt (newest first) and take latest 4
      const sortedRooms = userRooms
        .sort((a, b) => new Date(b.createdAt || b.updatedAt) - new Date(a.createdAt || a.updatedAt))
        .slice(0, 4);
      
      // Fetch creator info for each room
      const roomsWithCreator = await Promise.all(
        sortedRooms.map(async (room) => {
          try {
            const creator = await getUserById(room.createdBy);
            return { ...room, creatorInfo: creator };
          } catch (e) {
            return { ...room, creatorInfo: { fullname: room.createdBy, username: room.createdBy } };
          }
        })
      );
      
      setRooms(roomsWithCreator);
    } catch(e) { setErr(e.message); }
  }

  function formatDate(dateString) {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  }

  function handleOpenCreate() {
    setCreateModal(true);
    setErr(''); setMsg('');
  }

  async function handleCreateRoom(e) {
    e.preventDefault();
    setErr(''); setMsg(''); setLoading(true);
    try {
      const room = await createRoom({ userid: user.userid, locked });
      window.location.href = `/room/${room.roomid}`;
    } catch(e) { setErr(e.message); }
    setLoading(false);
  }

  async function handleJoinRoom(e) {
    e.preventDefault(); setErr(''); setMsg(''); setLoading(true);
    try {
      const res = await joinRoom({ userid: user.userid, roomid: joinRoomId });
      // If room is locked and user needs approval, go to lobby
      if(res.waiting) {
        if (typeof setRoute === 'function') {
          setRoute(`/room/${joinRoomId}/lobby`);
        } else {
          window.location.href = `/room/${joinRoomId}/lobby`;
        }
        setLoading(false);
        return;
      }
      // Otherwise, join directly (open room or already approved)
      if (typeof setRoute === 'function') {
        setRoute(`/room/${joinRoomId}`);
      } else {
        window.location.href = `/room/${joinRoomId}`;
      }
      loadRooms();
    } catch(e) { setErr(e.message); }
    setLoading(false);
  }

  async function handleLogout() {
    try { await logout(); } catch(_) {}
    window.location.href = '/enter';
  }

  return (
    <div className="homePage">
      <div className="topBar">
        <div className="logo">MoogleGeet</div>
        <div className="userInfo">
          {user && <div className="greeting">Hi, {user.fullname || user.username}</div>}
          <button className="logoutBtn" onClick={handleLogout}>Logout</button>
        </div>
      </div>
      
      <div className="divider"></div>
      
      <div className="welcomeSection">
        <p className="welcomeText">
          Welcome,<span>to MoogleGeet Rooms</span>
        </p>
      </div>

      <div className="actionCards">
        <div className="actionCard">
          <h3 className="cardTitle">Create a Room</h3>
          <button className="homeButton" onClick={handleOpenCreate} disabled={loading || !user}>New Room</button>
        </div>
        <div className="actionCard">
          <h3 className="cardTitle">Join a Room</h3>
          <form onSubmit={handleJoinRoom} className="joinForm">
            <input 
              className="homeInput" 
              value={joinRoomId} 
              onChange={e => setJoinRoomId(e.target.value)} 
              placeholder="Room ID" 
              required 
              disabled={!user || loading}
            />
            <button className="homeButton joinButton" type="submit" disabled={!user || loading}>Join Room</button>
          </form>
        </div>
      </div>

      {msg && <div className="message">{msg}</div>}
      {err && <div className="error">{err}</div>}

      {rooms.length > 0 && (
        <>
          <div className="divider"></div>
          <div className="roomsSection">
            <h2 className="sectionTitle">Recent Rooms</h2>
            <div className="roomsGrid">
              {rooms.map(r => (
                <div key={r.roomid} className={`roomCard ${r.locked ? 'locked' : 'open'}`}>
                  <div className="roomInfo">
                    <div className="roomLabel">
                      Room: <span className="roomId">{r.roomid}</span>
                    </div>
                    <div className="roomStatus">
                      Lock: {r.locked ? <span className="statusLocked">Locked</span> : <span className="statusOpen">Open</span>}
                    </div>
                    <div className="roomCreator">
                      Created by: <span className="creatorName">{r.creatorInfo?.fullname || r.creatorInfo?.username || r.createdBy}</span>
                    </div>
                    <div className="roomDate">
                      {formatDate(r.createdAt || r.updatedAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Modal for create room */}
      {createModal && (
        <div className="modalBg" onClick={() => setCreateModal(false)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <h3 className="modalTitle">Create Room</h3>
            <form onSubmit={handleCreateRoom} className="modalForm">
              <div className="modalField">
                <label className="modalLabel"><b>Room Lock?</b></label>
                <select 
                  className="homeSelect" 
                  value={locked} 
                  onChange={e => setLocked(e.target.value === 'true')}
                > 
                  <option value={false}>Open (Anyone can join)</option>
                  <option value={true}>Locked (Approve to join)</option>
                </select>
              </div>
              <div className="modalButtons">
                <button className="homeButton" type="submit" disabled={loading || !user}>Create</button>
                <button type="button" className="cancelBtn" onClick={() => setCreateModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
