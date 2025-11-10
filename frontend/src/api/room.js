const API_BASE = import.meta.env.VITE_API_URL 
  ? `${import.meta.env.VITE_API_URL}/api/room`
  : '/api/room';

export async function fetchRooms() {
    const res = await fetch(`${API_BASE}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Fetch rooms failed');
    return json.rooms;
}

export async function createRoom({ userid, locked }) {
    const res = await fetch(`${API_BASE}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userid, locked }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Create room failed');
    return json.room;
}

export async function joinRoom({ userid, roomid }) {
    const res = await fetch(`${API_BASE}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userid, roomid }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Join room failed');
    return json;
}

export async function handleJoinRequest({ roomid, userid, approve, adminid }) {
    const res = await fetch(`${API_BASE}/handle-join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomid, userid, approve, admin: adminid }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Approve/reject failed');
    return json;
}

export async function fetchRoomById(roomid) {
    const res = await fetch(`${API_BASE}/${roomid}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Fetch room failed');
    return json.room;
}
