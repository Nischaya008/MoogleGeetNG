// Vercel Serverless API Handler
// This file handles all REST API routes for Vercel deployment

const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const passport = require('passport');
require('../utils/passportGoogle');

const app = express();

// Middleware
app.use(express.json());
app.use(cookieParser());

// Initialize Passport (sessions handled via JWT cookies, not express-session)
app.use(passport.initialize());

// MongoDB connection with connection pooling for serverless
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }

  try {
    const db = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    cachedDb = db;
    console.log('MongoDB connected (serverless)');
    return db;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

// Connect to DB before handling requests
app.use(async (req, res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    res.status(500).json({ message: 'Database connection failed' });
  }
});

// API routes
app.use('/api/auth', require('../routes/auth'));
app.use('/api/room', require('../routes/room'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Zoogle API Server', status: 'running' });
});

// Export for Vercel serverless
module.exports = app;

