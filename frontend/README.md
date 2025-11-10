# Frontend - Zoogle

React + Vite frontend for Zoogle video conferencing application.

## Environment Variables

For local development, create a `.env.local` file:

```env
VITE_API_URL=http://localhost:5000
VITE_SOCKET_IO_URL=http://localhost:5000
```

For production (Vercel), set these in Vercel dashboard:
- `VITE_API_URL` - Backend API URL
- `VITE_SOCKET_IO_URL` - Socket.io server URL

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env.local` file with environment variables

3. Start the development server:
   ```bash
   npm run dev
   ```

4. The app will run on `http://localhost:5173`

## Production Deployment

See [DEPLOYMENT.md](../DEPLOYMENT.md) for Vercel deployment instructions.

## Build

```bash
npm run build
```

The build output will be in the `dist` directory.

## Project Structure

```
src/
  api/          # API client functions
  components/   # React components
  utils/        # Utility functions (WebRTC, etc.)
  assets/       # Static assets
  App.jsx       # Main app component
  main.jsx      # Entry point
```

## Features

- User authentication (email/password, Google OAuth)
- Room creation and joining
- Locked rooms with approval system
- Real-time video/audio calls (WebRTC)
- Media controls (mic/camera toggle)
- Participant management
