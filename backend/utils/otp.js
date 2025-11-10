const crypto = require('crypto');

function generateOTP() {
  const otp = (Math.floor(100000 + Math.random() * 900000)).toString();
  const otpExpires = Date.now() + 5 * 60 * 1000; // 5 minutes
  return { otp, otpExpires };
}

function isOTPValid(otp, otpExpires) {
  return otp && otpExpires && Date.now() < otpExpires;
}

module.exports = { generateOTP, isOTPValid };
