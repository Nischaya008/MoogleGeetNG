// Standalone Socket.io Server for Real-time Communication
// Deploy this separately (Railway, Render, Fly.io, etc.) as it requires persistent WebSocket connections

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const Room = require('./models/Room');

const app = express();
const server = http.createServer(app);

// CORS configuration for Socket.io
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  path: '/socket.io',
});

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('[Socket Server] MongoDB connected'))
  .catch((err) => console.error('[Socket Server] MongoDB connection error:', err));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'socket-server', timestamp: new Date().toISOString() });
});

// --- In-memory socket <-> user/room mappings
const SOCKET_USER = new Map(); // socket.id -> userId
const SOCKET_ROOM = new Map(); // socket.id -> roomid
// Track recently approved users to prevent race condition removal
const RECENTLY_APPROVED = new Map(); // userid_roomid -> timestamp
const APPROVAL_GRACE_PERIOD = 3000; // 3 seconds grace period after approval

// --- Signaling buffer for race-free WebRTC signaling
const SIGNAL_BUFFER = new Map(); // userid -> [{ event, data, timestamp }]
const SIGNAL_BUFFER_RETRIES = new Map(); // userid -> interval ID
const SIGNAL_BUFFER_TIMEOUT = 2000; // 2 seconds max buffer time

// Helper: flush buffered signals for a user
function flushSignalsForUser(userId) {
  const buffered = SIGNAL_BUFFER.get(userId);
  if (!buffered || buffered.length === 0) return;
  
  const sockets = socketsForUser(userId);
  if (sockets.length === 0) return; // Still no sockets, keep buffered
  
  console.log(`[Signal buffer] flushing ${buffered.length} messages for ${userId}`);
  
  buffered.forEach(({ event, data }) => {
    sockets.forEach(sid => {
      io.to(sid).emit(event, data);
    });
  });
  
  SIGNAL_BUFFER.delete(userId);
  
  // Clear retry interval if exists
  const retryId = SIGNAL_BUFFER_RETRIES.get(userId);
  if (retryId) {
    clearInterval(retryId);
    SIGNAL_BUFFER_RETRIES.delete(userId);
  }
}

// Helper: buffer a signal for later delivery
function bufferSignal(userId, event, data) {
  if (!SIGNAL_BUFFER.has(userId)) {
    SIGNAL_BUFFER.set(userId, []);
  }
  
  const buffer = SIGNAL_BUFFER.get(userId);
  buffer.push({ event, data, timestamp: Date.now() });
  
  console.log(`[Signal buffer] queued ${event} for ${userId} (will retry)`);
  
  // Set up retry mechanism if not already running
  if (!SIGNAL_BUFFER_RETRIES.has(userId)) {
    const retryInterval = setInterval(() => {
      const sockets = socketsForUser(userId);
      if (sockets.length > 0) {
        flushSignalsForUser(userId);
      } else {
        // Clean up old messages (older than timeout)
        const now = Date.now();
        const buffered = SIGNAL_BUFFER.get(userId);
        if (buffered) {
          const filtered = buffered.filter(msg => (now - msg.timestamp) < SIGNAL_BUFFER_TIMEOUT);
          if (filtered.length === 0) {
            SIGNAL_BUFFER.delete(userId);
            clearInterval(retryInterval);
            SIGNAL_BUFFER_RETRIES.delete(userId);
          } else {
            SIGNAL_BUFFER.set(userId, filtered);
          }
        }
      }
    }, 200); // Check every 200ms
    
    SIGNAL_BUFFER_RETRIES.set(userId, retryInterval);
    
    // Auto-cleanup after timeout
    setTimeout(() => {
      const retryId = SIGNAL_BUFFER_RETRIES.get(userId);
      if (retryId) {
        clearInterval(retryId);
        SIGNAL_BUFFER_RETRIES.delete(userId);
      }
      const remaining = SIGNAL_BUFFER.get(userId);
      if (remaining) {
        const now = Date.now();
        const filtered = remaining.filter(msg => (now - msg.timestamp) < SIGNAL_BUFFER_TIMEOUT);
        if (filtered.length === 0) {
          SIGNAL_BUFFER.delete(userId);
        } else {
          SIGNAL_BUFFER.set(userId, filtered);
        }
      }
    }, SIGNAL_BUFFER_TIMEOUT);
  }
}

// Helper: relay signal to target user
function relaySignal(toUserId, event, data) {
  const sockets = socketsForUser(toUserId);
  if (sockets.length > 0) {
    console.log(`[Signal relay] relaying ${event} to ${toUserId} sockets=${sockets.length}`);
    sockets.forEach(sid => {
      io.to(sid).emit(event, data);
    });
  } else {
    // Buffer for later
    bufferSignal(toUserId, event, data);
  }
}

// Helper: find all socket ids for a userId
function socketsForUser(userId) {
  const sockets = [];
  for (const [sid, uid] of SOCKET_USER.entries()) if (uid === userId) sockets.push(sid);
  return sockets;
}

// --- Socket.io event handlers ---
io.on('connection', (socket) => {
  console.log('[Socket.io] Client connected:', socket.id);

  // Helper: cleanup on disconnect or leave-room - remove user from participants and update DB
  async function cleanup() {
    const userid = SOCKET_USER.get(socket.id);
    const roomid = SOCKET_ROOM.get(socket.id);
    if (roomid && userid) {
      try {
        const room = await Room.findOne({ roomid });
        if (!room) return;
        
        // Check if leaving user is the host (for locked rooms, end meeting)
        const isHost = room.createdBy === userid;
        const wasParticipant = room.participants.includes(userid);
        const wasWaiting = room.waitingParticipants && room.waitingParticipants.includes(userid);
        
        // Check if user has any other active sockets in this room (BEFORE deleting current socket)
        // Count sockets for this user in this room, excluding the current one
        const allUserSockets = socketsForUser(userid);
        const socketsInThisRoom = allUserSockets.filter(sid => SOCKET_ROOM.get(sid) === roomid && sid !== socket.id);
        const hasOtherSockets = socketsInThisRoom.length > 0;
        
        // Now delete the current socket
        SOCKET_USER.delete(socket.id);
        SOCKET_ROOM.delete(socket.id);
        
        // Remove from waitingParticipants if user was waiting and has no other sockets (they left the lobby)
        let waitingUpdated = false;
        if (wasWaiting && !hasOtherSockets) {
          room.waitingParticipants = room.waitingParticipants.filter(u => u !== userid);
          await room.save();
          waitingUpdated = true;
          console.log(`[Socket.io] Removed user ${userid} from waiting list in room ${roomid} (left lobby)`);
        }
        
        // Only remove from participants if:
        // 1. User was a participant
        // 2. User is NOT the host (host stays in DB participants always)
        // 3. User has no other active sockets in this room (all tabs/connections closed)
        // 4. User was not recently approved (grace period to allow RoomPage socket to connect)
        const approvalKey = `${userid}_${roomid}`;
        const recentlyApproved = RECENTLY_APPROVED.get(approvalKey);
        const isRecentlyApproved = recentlyApproved && (Date.now() - recentlyApproved) < APPROVAL_GRACE_PERIOD;
        
        if (wasParticipant && !isHost && !hasOtherSockets && !isRecentlyApproved) {
          room.participants = room.participants.filter(u => u !== userid);
          await room.save();
          console.log(`[Socket.io] Removed user ${userid} from participants in room ${roomid}`);
        } else if (isRecentlyApproved) {
          console.log(`[Socket.io] Skipping removal of user ${userid} - recently approved (grace period)`);
        }
        
        // If waiting list was updated, emit the updated waiting list to host
        if (waitingUpdated) {
          io.to(roomid).emit('waiting-update', { waitingParticipants: room.waitingParticipants || [] });
          // Direct-to-host (in case they're not in room via socket.join)
          if (room.createdBy) for (const sid of socketsForUser(room.createdBy)) {
            io.to(sid).emit('waiting-update', { waitingParticipants: room.waitingParticipants || [] });
          }
        }
        
        // For locked rooms: if host left (no remaining sockets), end meeting for all participants
        if (isHost && room.locked && !hasOtherSockets) {
          console.log(`[Socket.io] Host ${userid} left locked room ${roomid} - ending meeting for all participants`);
          io.to(roomid).emit('host-left', { roomid, message: 'Host has left the meeting. The room has been closed.' });
          // Don't modify DB participants, just notify clients (host stays in DB but meeting ends)
          io.to(roomid).emit('participants-update', { participants: room.participants, createdBy: room.createdBy });
        } else if (isHost && !room.locked && !hasOtherSockets) {
          // For open rooms: host left - emit update (host stays in DB but show they've left)
          console.log(`[Socket.io] Host ${userid} left open room ${roomid}`);
          io.to(roomid).emit('participants-update', { participants: room.participants, createdBy: room.createdBy, hostActive: false });
        } else {
          // Normal participant left or host still has other sockets - emit updated list
          io.to(roomid).emit('participants-update', { participants: room.participants, createdBy: room.createdBy, hostActive: !isHost || hasOtherSockets });
        }
      } catch (err) {
        console.warn('[Socket.io][cleanup] error:', err.message);
      }
    }
  }

  socket.on('join-room', async ({ roomid, userid }) => {
    try {
      socket.join(roomid);
      SOCKET_USER.set(socket.id, userid);
      SOCKET_ROOM.set(socket.id, roomid);
      // Clear recently approved flag if user is connecting to room (they made it!)
      const approvalKey = `${userid}_${roomid}`;
      if (RECENTLY_APPROVED.has(approvalKey)) {
        RECENTLY_APPROVED.delete(approvalKey);
        console.log(`[Socket.io] User ${userid} connected to room ${roomid} - cleared approval grace period`);
      }
      // Flush any buffered signals for this user
      flushSignalsForUser(userid);
      // fetch fresh from DB for canonical lists
      const room = await Room.findOne({ roomid });
      if (!room) return;
      // Check if host has active sockets
      const hostSockets = socketsForUser(room.createdBy).filter(sid => SOCKET_ROOM.get(sid) === roomid);
      const hostActive = hostSockets.length > 0;
      // Include createdBy (host) info in participants-update, and host active status
      // Send update to the specific socket first, then broadcast
      socket.emit('participants-update', { participants: room.participants, createdBy: room.createdBy, hostActive });
      io.to(roomid).emit('participants-update', { participants: room.participants, createdBy: room.createdBy, hostActive });
      // Send full waiting list (for all hosts and this socket)
      if (room.locked) {
        // Send latest waiting list to host and room
        io.to(roomid).emit('waiting-update', { waitingParticipants: room.waitingParticipants || [] });
        // Direct-to-host (in case they're not in room via socket.join)
        if (room.createdBy) for (const sid of socketsForUser(room.createdBy)) {
          io.to(sid).emit('waiting-update', { waitingParticipants: room.waitingParticipants || [] });
        }
      }
      // Send latest waiting list to ONLY requesting socket as well
      socket.emit('waiting-update', { waitingParticipants: room.waitingParticipants || [] });
    } catch (err) {
      console.warn('[Socket.io][join-room] error:', err.message);
    }
  });

  socket.on('leave-room', async () => {
    await cleanup();
  });

  socket.on('ask-join', async ({ roomid, userid }) => {
    try {
      const room = await Room.findOne({ roomid });
      if (!room) return;
      if (room.locked && !room.waitingParticipants.includes(userid)) {
        room.waitingParticipants.push(userid);
        await room.save();
      }
      // (Always emit after DB update) To all in room and host's sockets
      io.to(roomid).emit('waiting-update', { waitingParticipants: room.waitingParticipants });
      if (room.createdBy) for (const sid of socketsForUser(room.createdBy)) {
        io.to(sid).emit('waiting-update', { waitingParticipants: room.waitingParticipants });
      }
      console.log(`[Socket.io][ask-join] User ${userid} requested join to room ${roomid}. Waiting:`, room.waitingParticipants.length);
    } catch (err) {
      console.warn('[Socket.io][ask-join] error:', err.message);
    }
  });

  socket.on('host-approve', async ({ roomid, userid, approve }) => {
    try {
      const room = await Room.findOne({ roomid });
      if (!room) return;
      // Only allow host to approve if correct
      if (room.createdBy !== SOCKET_USER.get(socket.id)) return;
      if (!room.waitingParticipants.includes(userid)) return;
      if (approve) {
        if (!room.participants.includes(userid)) room.participants.push(userid);
        // Mark user as recently approved to prevent race condition removal
        const approvalKey = `${userid}_${roomid}`;
        RECENTLY_APPROVED.set(approvalKey, Date.now());
        // Clean up after grace period
        setTimeout(() => {
          RECENTLY_APPROVED.delete(approvalKey);
        }, APPROVAL_GRACE_PERIOD);
      }
      room.waitingParticipants = room.waitingParticipants.filter(u => u !== userid);
      await room.save();
      // Check if host is active for the update
      const hostSockets = socketsForUser(room.createdBy).filter(sid => SOCKET_ROOM.get(sid) === roomid);
      const hostActive = hostSockets.length > 0;
      // Include createdBy in participants-update
      io.to(roomid).emit('participants-update', { participants: room.participants, createdBy: room.createdBy, hostActive });
      io.to(roomid).emit('waiting-update', { waitingParticipants: room.waitingParticipants });
      if (room.createdBy) for (const sid of socketsForUser(room.createdBy)) {
        io.to(sid).emit('waiting-update', { waitingParticipants: room.waitingParticipants });
      }
      // Notify approved user
      for (const sid of socketsForUser(userid)) {
        io.to(sid).emit('participant-approved', { roomid, userid, approve });
      }
      console.log(`[Socket.io][host-approve] Host ${room.createdBy} responded ${approve ? 'APPROVE' : 'REJECT'} for user ${userid} in room ${roomid}`);
    } catch (err) {
      console.warn('[Socket.io][host-approve] error:', err.message);
    }
  });

  socket.on('get-waiting-list', async ({ roomid }) => {
    try {
      const room = await Room.findOne({ roomid });
      if (!room) return;
      socket.emit('waiting-update', { waitingParticipants: room.waitingParticipants });
    } catch (err) { console.warn('[Socket.io][get-waiting-list] error:', err.message); }
  });

  // --- WebRTC signaling handlers ---
  socket.on('media-offer', ({ to, from, offer }) => {
    relaySignal(to, 'media-offer', { from, offer });
  });

  socket.on('media-answer', ({ to, from, answer }) => {
    relaySignal(to, 'media-answer', { from, answer });
  });

  socket.on('media-candidate', ({ to, from, candidate }) => {
    relaySignal(to, 'media-candidate', { from, candidate });
  });

  socket.on('media-toggle', ({ roomid, userid, micEnabled, cameraEnabled }) => {
    // Broadcast media toggle to all other participants in the room
    const roomSockets = Array.from(SOCKET_ROOM.entries())
      .filter(([sid, rid]) => rid === roomid && SOCKET_USER.get(sid) !== userid)
      .map(([sid]) => sid);
    
    if (roomSockets.length > 0) {
      console.log(`[Signal relay] relaying media-toggle from ${userid} to ${roomSockets.length} sockets`);
      roomSockets.forEach(sid => {
        io.to(sid).emit('media-toggle', { userid, micEnabled, cameraEnabled });
      });
    }
  });

  socket.on('disconnect', async () => {
    await cleanup();
    console.log('[Socket.io] Client disconnected:', socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`[Socket Server] Running on port ${PORT}`);
  console.log(`[Socket Server] CORS origin: ${process.env.CLIENT_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:5173'}`);
});

