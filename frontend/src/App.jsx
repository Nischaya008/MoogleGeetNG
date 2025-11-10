import { useState, useEffect } from 'react';
import AuthForm from './components/AuthForm.jsx';
import LandingPage from './components/LandingPage.jsx';
import HomePage from './components/HomePage.jsx';
import RoomPage from './components/RoomPage.jsx';
import LobbyPage from './components/LobbyPage.jsx';

// Basic router expanded for /room/:roomid
function useRoute() {
  const [route, setRoute] = useState(window.location.pathname);
  useEffect(() => {
    const handler = () => setRoute(window.location.pathname);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);
  return [route, (r) => { window.history.pushState({}, '', r); setRoute(r); }];
}

function parseRoomId(route) {
  const match = route.match(/^\/room\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}
function parseLobbyId(route) {
  const match = route.match(/^\/room\/([a-zA-Z0-9]+)\/lobby/);
  return match ? match[1] : null;
}

export default function App() {
  const [route, setRoute] = useRoute();
  if (route === '/enter') return <AuthForm />;
  if (route === '/home') return <HomePage setRoute={setRoute} />;
  const lobbyid = parseLobbyId(route);
  if (lobbyid) return <LobbyPage roomid={lobbyid} setRoute={setRoute} />;
  const roomid = parseRoomId(route);
  if (roomid) return <RoomPage roomid={roomid} setRoute={setRoute} />;
  return <LandingPage setRoute={setRoute} />;
}
