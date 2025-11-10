import { useState, useEffect } from 'react';
import { register, verifyOtp, signin, googleAuth, getCurrentUser } from '../api/auth';
import SignupCard from './auth/SignupCard.jsx';
import SigninCard from './auth/SigninCard.jsx';
import OtpCard from './auth/OtpCard.jsx';

const INIT_SIGNUP = { username: '', fullname: '', email: '', password: '' };
const INIT_SIGNIN = { identity: '', password: '' };
const INIT_OTP = { email: '', otp: '' };

export default function AuthForm() {
    const [mode, setMode] = useState('signup'); // signin | signup | otp
    const [signup, setSignup] = useState(INIT_SIGNUP);
    const [signinD, setSigninD] = useState(INIT_SIGNIN);
    const [otpD, setOtpD] = useState(INIT_OTP);
    const [msg, setMsg] = useState('');
    const [err, setErr] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const user = await getCurrentUser();
                if (user) { window.location.href = '/home'; }
            } catch (_) {}
        })();
    }, []);

    function resetAll() {
        setSignup(INIT_SIGNUP); setSigninD(INIT_SIGNIN); setOtpD(INIT_OTP); setMsg(''); setErr('');
    }
    async function handleSignup(e) {
        e.preventDefault(); setErr(''); setMsg(''); setLoading(true);
        try {
            await register(signup);
            setMsg('OTP sent to your email. Check inbox/spam.');
            setOtpD(o => ({ ...o, email: signup.email }));
            setMode('otp');
        } catch (e) { setErr(e.message); }
        setLoading(false);
    }
    async function handleVerifyOtp(e) {
        e.preventDefault(); setErr(''); setMsg(''); setLoading(true);
        try {
            await verifyOtp(otpD);
            setMsg('Account verified! Redirecting to home...');
            setTimeout(() => { window.location.href = '/home'; }, 1300);
        } catch (e) { setErr(e.message); }
        setLoading(false);
    }
    async function handleSignin(e) {
        e.preventDefault(); setErr(''); setMsg(''); setLoading(true);
        try {
            await signin(signinD);
            setMsg('Signin successful! Redirecting to home...');
            setTimeout(() => { window.location.href = '/home'; }, 1000);
        } catch (e) { setErr(e.message); }
        setLoading(false);
    }
    function switchMode(m) {
        resetAll();
        setMode(m);
    }

    // Outer bg for centering and color
    return (
        <div style={outerBgS}>
            {mode === 'signup' ? (
                <SignupCard
                    signup={signup}
                    setSignup={setSignup}
                    loading={loading}
                    onSubmit={handleSignup}
                    onSwitchToSignin={() => switchMode('signin')}
                    onGoogle={googleAuth}
                    msg={msg}
                    err={err}
                />
            ) : mode === 'otp' ? (
                <OtpCard
                    otpD={otpD}
                    setOtpD={setOtpD}
                    loading={loading}
                    onSubmit={handleVerifyOtp}
                    onSwitchToSignup={() => switchMode('signup')}
                    msg={msg}
                    err={err}
                />
            ) : (
                <SigninCard
                    signinD={signinD}
                    setSigninD={setSigninD}
                    loading={loading}
                    onSubmit={handleSignin}
                    onSwitchToSignup={() => switchMode('signup')}
                    onGoogle={googleAuth}
                    msg={msg}
                    err={err}
                />
            )}
        </div>
    );
}

// --- Styles ---
const outerBgS = {
    minHeight: '100vh',
    minWidth: '100vw',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#F5F0E4',
};
