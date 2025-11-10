import React from 'react';
import './SignupCard.css';

export default function OtpCard({ otpD, setOtpD, loading, onSubmit, onSwitchToSignup, msg, err }) {
    return (
        <form action="" className="form otpForm" onSubmit={onSubmit}>
            <p>
                Welcome,<span>verify OTP to continue</span>
            </p>

            <div className="row">
                <input
                    className="textInput"
                    type="email"
                    placeholder="Email"
                    name="email"
                    required
                    value={otpD.email}
                    onChange={(e) => setOtpD(o => ({ ...o, email: e.target.value }))}
                    disabled={loading}
                />
                <input
                    className="textInput"
                    type="text"
                    placeholder="OTP Code"
                    name="otp"
                    required
                    value={otpD.otp}
                    onChange={(e) => setOtpD(o => ({ ...o, otp: e.target.value }))}
                    disabled={loading}
                />
            </div>

            {msg && <div style={{ gridColumn: '1 / -1', color: '#35743d', background: '#ecffe5', borderRadius: 4, padding: '8px 12px', marginBottom: 10, textAlign: 'center', fontSize: 15 }}>{msg}</div>}
            {err && <div style={{ gridColumn: '1 / -1', color: '#d01436', background: '#fff2f4', borderRadius: 4, padding: '8px 12px', marginBottom: 10, textAlign: 'center', fontSize: 15 }}>{err}</div>}

            <button className="oauthButton" type="submit" disabled={loading}>
                Verify OTP
                <svg className="icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 17 5-5-5-5"></path><path d="m13 17 5-5-5-5"></path></svg>
            </button>

            <button className="oauthButton" type="button" onClick={onSwitchToSignup} disabled={loading}
                style={{marginTop: 6}}>
                Back to signup
            </button>
        </form>
    );
}
