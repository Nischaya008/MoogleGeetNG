import React from 'react';

export default function LandingPage({ setRoute }) {
  const goToEnter = () => {
    if (typeof setRoute === 'function') {
      setRoute('/enter');
    } else {
      window.location.href = '/enter';
    }
  };

  return (
    <div style={outerS}>
      <div style={cardS}>
        <h1 style={titleS}>MoogleGeet</h1>
        <p style={subtitleS}>Lightweight rooms with optional lobby approval.</p>
        <button style={btnS} onClick={goToEnter}>Enter</button>
      </div>
    </div>
  );
}

const outerS = { minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'linear-gradient(120deg, #f7fafc 0%, #e3edfa 100%)', padding:'40px 20px' };
const cardS = { background:'#fff', borderRadius:14, padding:'40px 32px', boxShadow:'0 8px 36px #93acc340, 0 1.5px 4px #00000012', textAlign:'center', minWidth:300 };
const titleS = { margin:0, fontSize:36, fontWeight:800, color:'#233c60', letterSpacing:0.5 };
const subtitleS = { margin:'12px 0 24px 0', color:'#5a6b85' };
const btnS = { padding:'12px 24px', border:'none', borderRadius:8, background:'linear-gradient(90deg,#1976d2 60%,#51aef6)', color:'#fff', fontWeight:700, fontSize:16, cursor:'pointer' };


