const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  roomid: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  createdBy: {
    type: String, // user.userid or email
    required: true,
    immutable: true // Cannot be changed once set - host never changes
  },
  locked: {
    type: Boolean,
    default: false
  },
  participants: [ // Joined/active participants (userids or emails)
    { type: String }
  ],
  waitingParticipants: [ // Waiting for approval (if locked)
    { type: String }
  ]
}, {
  timestamps: true
});

module.exports = mongoose.model('Room', roomSchema);
