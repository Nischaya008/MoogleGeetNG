const API_BASE = '/api/auth';

export async function register(form) {
    const res = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        credentials: 'include',
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Registration failed');
    return json;
}

export async function verifyOtp(form) {
    const res = await fetch(`${API_BASE}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        credentials: 'include',
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'OTP failed');
    return json;
}

export async function signin(form) {
    const res = await fetch(`${API_BASE}/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        credentials: 'include',
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Signin failed');
    return json;
}

// For Google, redirect to backend endpoint
export function googleAuth() {
    window.location.href = `${API_BASE}/google`;
}

export async function getCurrentUser() {
    const res = await fetch(`${API_BASE}/me`, {
        method: 'GET',
        credentials: 'include',
    });
    if (res.status === 401) return null;
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Fetch user failed');
    return json.user;
}

export async function logout() {
    const res = await fetch(`${API_BASE}/logout`, {
        method: 'POST',
        credentials: 'include',
    });
    if (!res.ok) throw new Error('Logout failed');
    return true;
}

export async function getUserById(userid) {
    const res = await fetch(`${API_BASE}/user/${userid}`, {
        method: 'GET',
        credentials: 'include',
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Fetch user failed');
    return json.user;
}