const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// POST /api/auth/register
router.post('/register', authController.register);
// POST /api/auth/verify-otp
router.post('/verify-otp', authController.verifyOtp);
// POST /api/auth/signin
router.post('/signin', authController.signin);
// Google OAuth2
router.get('/google', authController.googleAuth);
router.get('/google/callback',
  require('passport').authenticate('google', { failureRedirect: '/api/auth/google-failed' }),
  authController.googleCallback
);
// Optional: failure route
router.get('/google-failed', (req, res) => res.status(401).json({ message: 'Google authentication failed' }));

// GET /api/auth/me - get current user info (session)
router.get('/me', require('../controllers/authController').getMe);

// GET /api/auth/user/:userid - get user info by userid
router.get('/user/:userid', require('../controllers/authController').getUserById);

// POST /api/auth/logout - clear session
router.post('/logout', require('../controllers/authController').logout);

module.exports = router;
