const Room = require('../models/Room');
const User = require('../models/User');
const { v4: uuidv4 } = require('uuid');

// Helper: extract userid or email from req (to plug in auth later)
function getUserIdentifier(req) {
  // Normally: req.user.userid or req.user.email; fallback to body for now
  return req.user?.userid || req.body.userid || req.body.email;
}

// CREATE ROOM
exports.createRoom = async (req, res) => {
  try {
    const createdBy = getUserIdentifier(req);
    const { locked = false } = req.body;
    const roomid = uuidv4().slice(0,8); // Short 8-char roomid
    const room = new Room({ roomid, createdBy, locked, participants: [createdBy] });
    await room.save();
    res.json({ message: 'Room created', room });
  } catch(err) { res.status(500).json({ message: err.message }); }
};

// GET ALL ROOMS
exports.getRooms = async (req, res) => {
  try {
    const rooms = await Room.find();
    res.json({ rooms });
  } catch(err) { res.status(500).json({ message: err.message }); }
};

// GET ROOM BY ID
exports.getRoomById = async (req, res) => {
  try {
    const { roomid } = req.params;
    const room = await Room.findOne({ roomid });
    if (!room) return res.status(404).json({ message: 'Room not found' });
    res.json({ room });
  } catch(err) { res.status(500).json({ message: err.message }); }
};

// JOIN ROOM (directly if unlocked, add to waiting if locked)
exports.joinRoom = async (req, res) => {
  try {
    const user = getUserIdentifier(req);
    const { roomid } = req.body;
    const room = await Room.findOne({ roomid });
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (room.participants.includes(user)) {
      return res.json({ message: 'Already a participant', room });
    }
    if (!room.locked) {
      room.participants.push(user);
      await room.save();
      return res.json({ message: 'Joined room', room });
    }
    // If locked, place in waiting list if not already
    if (!room.waitingParticipants.includes(user)) {
      room.waitingParticipants.push(user);
      await room.save();
    }
    return res.json({ message: 'Requested to join. Wait for approval.', waiting: true, room });
  } catch(err) { res.status(500).json({ message: err.message }); }
};

// APPROVE/REJECT waiting participant
exports.handleJoinRequest = async (req, res) => {
  try {
    const admin = getUserIdentifier(req); // Should match room.createdBy
    const { roomid, userid, approve } = req.body;
    const room = await Room.findOne({ roomid });
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (room.createdBy !== admin) return res.status(403).json({ message: 'Not room admin' });
    if (!room.waitingParticipants.includes(userid)) return res.status(404).json({ message: 'User not waiting' });
    if (approve) {
      room.participants.push(userid);
    }
    room.waitingParticipants = room.waitingParticipants.filter(u => u !== userid);
    await room.save();
    res.json({ message: approve ? 'User approved' : 'User rejected', room });
  } catch(err) { res.status(500).json({ message: err.message }); }
};
