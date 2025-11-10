const User = require('../models/User');
const Otp = require('../models/Otp');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { generateOTP, isOTPValid } = require('../utils/otp');
const { sendOTPEmail } = require('../utils/mailer');
const passport = require('passport');

// 1. REGISTER (Begin email registration, create account as pending)
exports.register = async (req, res) => {
  try {
    const { username, fullname, email, password } = req.body;
    if (!(username && fullname && email && password))
      return res.status(400).json({ message: 'All fields required' });
    const exist = await User.findOne({ $or: [ { email }, { username } ] });
    if (exist) return res.status(400).json({ message: 'Email or username already used' });
    const userid = require('crypto').randomBytes(6).toString('hex');
    const user = new User({ userid, username, fullname, email, password, isVerified: false, googleAuth: false });
    await user.save();
    // If previous OTPs exist, remove
    await Otp.deleteMany({ email });
    // Generate/send OTP
    const { otp, otpExpires } = generateOTP();
    const otpDb = new Otp({ email, otp, otpExpires });
    await otpDb.save();
    await sendOTPEmail(email, otp);
    res.json({ message: 'User registered. OTP sent to email.' });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ message: 'Registration failed. Please try again.' });
  }
}

// 2. OTP VERIFICATION
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!(email && otp)) return res.status(400).json({ message: 'Email and OTP required' });
    const dbOtp = await Otp.findOne({ email });
    if (!dbOtp || dbOtp.otp !== otp || !isOTPValid(dbOtp.otp, dbOtp.otpExpires)) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }
    // Mark user as verified
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'User not found' });
    user.isVerified = true;
    await user.save();
    await Otp.deleteMany({ email });
    // Automatically log the user in by creating a session/JWT token
    const token = jwt.sign({ userid: user.userid, email: user.email }, process.env.SESSION_SECRET, { expiresIn: '30d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 30*24*60*60*1000 });
    res.json({ message: 'Account verified and logged in successfully.', token });
  } catch (err) {
    console.error('Verify OTP error:', err.message);
    res.status(500).json({ message: 'Verification failed. Please try again.' });
  }
}

// 3. CLASSIC SIGNIN (Only if isVerified=true)
exports.signin = async (req, res) => {
  const { identity, password } = req.body;
  if (!(identity && password)) return res.status(400).json({ message: 'Required' });
  const user = await User.findOne({ $or: [ { email: identity }, { username: identity } ] });
  if (!user) return res.status(400).json({ message: 'No such user' });
  if (!user.isVerified)
    return res.status(401).json({ message: 'Please verify your email before signing in.' });
  if (user.googleAuth) return res.status(400).json({ message: 'Use Google for this account' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ message: 'Password incorrect' });
  // Issue JWT
  const token = jwt.sign({ userid: user.userid, email: user.email }, process.env.SESSION_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 30*24*60*60*1000 });
  res.json({ message: 'Signin successful', token });
};

// 4. GOOGLE OAUTH2 ENDPOINTS
// Phase 1: Initiate Google OAuth
exports.googleAuth = passport.authenticate('google', { scope: ['profile', 'email'] });

// Phase 2: Callback handler, sets session/JWT
exports.googleCallback = (req, res) => {
  // Issued user by passport.js
  const user = req.user;
  if (!user) return res.status(400).json({ message: 'Google Auth failed' });
  const token = jwt.sign({ userid: user.userid, email: user.email }, process.env.SESSION_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 30*24*60*60*1000 });
  // Redirect to frontend home
  const frontendRedirect = process.env.FRONTEND_REDIRECT_AFTER_LOGIN || 'http://localhost:5173/home';
  res.redirect(frontendRedirect);
};

exports.getMe = async (req, res) => {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: 'Not signed in' });
    const decoded = jwt.verify(token, process.env.SESSION_SECRET);
    const user = await User.findOne({ userid: decoded.userid });
    if (!user) return res.status(401).json({ message: 'User not found' });
    res.json({ user: { userid: user.userid, email: user.email, username: user.username, fullname: user.fullname, avatar: user.avatar } });
  } catch (e) { res.status(401).json({ message: 'Invalid session' }); }
};

exports.getUserById = async (req, res) => {
  try {
    const { userid } = req.params;
    const user = await User.findOne({ userid });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user: { userid: user.userid, email: user.email, username: user.username, fullname: user.fullname, avatar: user.avatar } });
  } catch (e) {
    res.status(500).json({ message: 'Failed to fetch user' });
  }
};

exports.logout = (req, res) => {
  try {
    res.clearCookie('token');
    if (req.logout) {
      req.logout(() => {});
    }
    res.json({ message: 'Logged out' });
  } catch (e) {
    res.status(500).json({ message: 'Logout failed' });
  }
};