// Vercel Serverless API Handler
// This file handles all REST API routes for Vercel deployment
// Located in /api folder for Vercel's file-based routing

const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const passport = require('passport');

// Import passport config
require('../backend/utils/passportGoogle');

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

// API routes - Vercel serves from /api, so routes should be relative to /api
// /api/auth/* routes
app.use('/auth', require('../backend/routes/auth'));
// /api/room/* routes
app.use('/room', require('../backend/routes/room'));

// Health check at /api/health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root API endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Zoogle API Server', status: 'running', version: '1.0.0' });
});

// Export for Vercel serverless
// Vercel will automatically handle this as a serverless function
module.exports = app;

