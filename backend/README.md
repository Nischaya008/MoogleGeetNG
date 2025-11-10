# Backend - Zoogle

Express.js backend with Socket.io for real-time communication and WebRTC signaling.

## Environment Variables

Create a `.env` file in the backend directory with the following variables:

```env
NODE_ENV=production
PORT=5000
MONGO_URI=your-mongodb-connection-string
SESSION_SECRET=your-super-secret-key-min-32-chars
CLIENT_ORIGIN=https://your-frontend.vercel.app
FRONTEND_REDIRECT_AFTER_LOGIN=https://your-frontend.vercel.app/home
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=https://your-backend.railway.app/api/auth/google/callback
RESEND_API_KEY=your-resend-api-key
```

See [DEPLOYMENT.md](../DEPLOYMENT.md) for detailed deployment instructions.

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env` file with your environment variables

3. Run the development server:
   ```bash
   npm run dev
   ```

4. The server will run on `http://localhost:5000`

## Production Deployment

See [DEPLOYMENT.md](../DEPLOYMENT.md) for Railway deployment instructions.

## API Endpoints

### Auth Routes (`/api/auth`)
- `POST /api/auth/register` - Register new user
- `POST /api/auth/verify-otp` - Verify OTP
- `POST /api/auth/signin` - Sign in
- `GET /api/auth/google` - Initiate Google OAuth
- `GET /api/auth/google/callback` - Google OAuth callback
- `GET /api/auth/me` - Get current user
- `GET /api/auth/user/:userid` - Get user by ID
- `POST /api/auth/logout` - Logout

### Room Routes (`/api/room`)
- `GET /api/room` - Get all rooms
- `POST /api/room/create` - Create room
- `POST /api/room/join` - Join room
- `POST /api/room/handle-join` - Handle join request
- `GET /api/room/:roomid` - Get room by ID

## Socket.io Events

- `join-room` - Join a room
- `leave-room` - Leave a room
- `ask-join` - Request to join (locked rooms)
- `host-approve` - Host approve/reject join request
- `get-waiting-list` - Get waiting participants
- `media-offer` - WebRTC offer
- `media-answer` - WebRTC answer
- `media-candidate` - WebRTC ICE candidate
- `media-toggle` - Toggle media (mic/camera)

