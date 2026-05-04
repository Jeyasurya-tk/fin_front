const express = require('express');
const router = express.Router();
const {
  sendOTP, resendOTP, verifyOTP,
  register, registerSendOTP,
  getMe, updateProfile, updateSettings, deleteAccount,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Auth flows
router.post('/send-otp', sendOTP);               // Login — existing users only
router.post('/resend-otp', resendOTP);            // Resend OTP (login or register)
router.post('/verify-otp', verifyOTP);            // Login verification
router.post('/register/send-otp', registerSendOTP); // Registration OTP
router.post('/register', register);               // Complete registration

// Protected
router.get('/me', protect, getMe);
router.patch('/profile', protect, updateProfile);
router.patch('/settings', protect, updateSettings);
router.delete('/account', protect, deleteAccount);

module.exports = router;
