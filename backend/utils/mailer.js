const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

const RESEND_API_KEY = process.env.RESEND_API_KEY;

async function sendOTPEmail(to, otp) {
  const subject = 'Your OTP Code';
  const text = `Your OTP for MoogleGeet signup is: ${otp}. It is valid for 5 minutes.`;

  // Dev-friendly fallback when key is missing
  if (!RESEND_API_KEY) {
    console.warn('[mailer] RESEND_API_KEY not set. Skipping real email send.');
    console.log(`[mailer] OTP for ${to}: ${otp}`);
    return { mocked: true };
  }

  try {
    const res = await axios.post('https://api.resend.com/emails', {
      from: "onboarding@resend.dev",
      to,
      subject,
      text,
    }, {
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      }
    });
    return res.data;
  } catch (err) {
    console.warn('[mailer] Resend API failed, falling back to console OTP. Cause:', err.response?.status || err.message);
    console.log(`[mailer] OTP for ${to}: ${otp}`);
    return { mocked: true, error: true };
  }
}

module.exports = { sendOTPEmail };
