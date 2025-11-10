const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  userid: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  username: {
    type: String,
    required: true,
    unique: true,
    minlength: 3
  },
  fullname: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  avatar: {
    type: String,
    required: false // Will generate or use default
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
    validate: {
      validator: function(v) {
        // Password: min 6 characters, must include letters, numbers, and at least one special character
        return /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^a-zA-Z\d]).{6,}$/.test(v);
      },
      message: props => `Password must be at least 6 characters, include a number, a letter, and a special character`
    }
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  googleAuth: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Hash password before save (but only if not a google account)
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  if (this.googleAuth) return next(); // Google users have no password for local auth
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Avatar logic
userSchema.pre('save', function(next) {
  if (this.avatar) return next();
  if (this.googleAuth) {
    // Set to Google's default email avatar (Gravatar-style)
    const gravatar = `https://www.gravatar.com/avatar/${require('crypto').createHash('md5').update(this.email).digest('hex')}?d=identicon`;
    this.avatar = gravatar;
  } else {
    // First alphabet of first and last name
    const names = this.fullname.split(' ');
    const initials = names[0][0].toUpperCase() + (names.length > 1 ? names[names.length-1][0].toUpperCase() : '');
    this.avatar = `https://ui-avatars.com/api/?name=${initials}`;
  }
  next();
});

module.exports = mongoose.model('User', userSchema);
