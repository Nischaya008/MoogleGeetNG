const express = require('express');
const router = express.Router();
const roomController = require('../controllers/roomController');

// POST /api/room/create - create room
router.post('/create', roomController.createRoom);
// GET /api/room - fetch all rooms
router.get('/', roomController.getRooms);
// POST /api/room/join - join room
router.post('/join', roomController.joinRoom);
// POST /api/room/handle-join - approve/reject join request
router.post('/handle-join', roomController.handleJoinRequest);
// GET /api/room/:roomid - fetch single room by ID (must be last to avoid route conflicts)
router.get('/:roomid', roomController.getRoomById);

module.exports = router;
