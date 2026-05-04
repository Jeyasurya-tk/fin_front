const User = require('../models/User');
const Team = require('../models/Team');
const jwt = require('jsonwebtoken');

const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// ─── Helpers ────────────────────────────────────────────────────────────────

const OTP_EXPIRY_MS   = 30 * 1000;          // 30 seconds
const OTP_LOCK_MS     = 24 * 60 * 60 * 1000; // 24 hours
const MAX_OTP_TRIES   = 3;

const isLocked = (user) => user.otpLockedUntil && user.otpLockedUntil > new Date();

const lockInfo = (user) => {
  const remaining = Math.ceil((new Date(user.otpLockedUntil) - Date.now()) / 1000 / 60);
  return `Account locked. Try again in ${remaining} minute(s).`;
};

// ─── POST /api/auth/send-otp (LOGIN flow — registered users only) ────────────
const sendOTP = async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile) return res.status(400).json({ success: false, message: 'Mobile is required' });

    const user = await User.findOne({ mobile });
    if (!user) {
      return res.status(404).json({ success: false, message: 'No account found. Please register first.' });
    }

    if (isLocked(user)) return res.status(403).json({ success: false, message: lockInfo(user) });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpiry = new Date(Date.now() + OTP_EXPIRY_MS);
    user.otpAttempts = 0;
    await user.save();

    console.log(`📱 Login OTP for ${mobile}: ${otp}`);
    res.json({ success: true, message: 'OTP sent', otp }); // otp returned for dev
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── POST /api/auth/resend-otp ───────────────────────────────────────────────
const resendOTP = async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile) return res.status(400).json({ success: false, message: 'Mobile is required' });

    const user = await User.findOne({ mobile });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (isLocked(user)) return res.status(403).json({ success: false, message: lockInfo(user) });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpiry = new Date(Date.now() + OTP_EXPIRY_MS);
    user.otpAttempts = 0;
    await user.save();

    console.log(`📱 Resend OTP for ${mobile}: ${otp}`);
    res.json({ success: true, message: 'OTP resent', otp });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── POST /api/auth/verify-otp (LOGIN) ──────────────────────────────────────
const verifyOTP = async (req, res) => {
  try {
    const { mobile, otp } = req.body;
    if (!mobile || !otp) return res.status(400).json({ success: false, message: 'Mobile and OTP required' });

    const user = await User.findOne({ mobile });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (isLocked(user)) return res.status(403).json({ success: false, message: lockInfo(user) });

    // OTP expired
    if (!user.otpExpiry || user.otpExpiry < new Date()) {
      return res.status(400).json({ success: false, message: 'OTP expired. Please request a new one.' });
    }

    // Wrong OTP
    if (user.otp !== otp) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;

      if (user.otpAttempts >= MAX_OTP_TRIES) {
        user.otpLockedUntil = new Date(Date.now() + OTP_LOCK_MS);
        user.otp = null;
        user.otpExpiry = null;
        user.otpAttempts = 0;
        await user.save();
        return res.status(403).json({ success: false, message: 'Too many wrong attempts. Account locked for 24 hours.' });
      }

      // Immediately invalidate & force resend
      user.otp = null;
      user.otpExpiry = null;
      await user.save();

      const remaining = MAX_OTP_TRIES - user.otpAttempts;
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${remaining} attempt(s) remaining. Please request a new OTP.`,
        invalidated: true,
      });
    }

    // ✅ Valid
    user.otp = null;
    user.otpExpiry = null;
    user.otpAttempts = 0;
    await user.save();

    const token = generateToken(user._id);
    res.json({
      success: true, token,
      user: { _id: user._id, mobile: user.mobile, username: user.username, role: user.role, teamId: user.teamId, avatar: user.avatar },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── POST /api/auth/register ─────────────────────────────────────────────────
const register = async (req, res) => {
  try {
    const { mobile, username, otp } = req.body;
    if (!mobile || !username || !otp) return res.status(400).json({ success: false, message: 'All fields required' });

    let user = await User.findOne({ mobile });

    if (user && user.isActive && user.otp === null && user.otpExpiry === null && !user.username.startsWith('Player_')) {
      // Fully registered user — reject duplicate
      return res.status(400).json({ success: false, message: 'Account already exists. Please login.' });
    }

    if (!user) return res.status(404).json({ success: false, message: 'Send OTP first' });
    if (isLocked(user)) return res.status(403).json({ success: false, message: lockInfo(user) });

    if (!user.otpExpiry || user.otpExpiry < new Date()) {
      return res.status(400).json({ success: false, message: 'OTP expired. Request a new one.' });
    }

    if (user.otp !== otp) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      if (user.otpAttempts >= MAX_OTP_TRIES) {
        user.otpLockedUntil = new Date(Date.now() + OTP_LOCK_MS);
        user.otp = null; user.otpExpiry = null; user.otpAttempts = 0;
        await user.save();
        return res.status(403).json({ success: false, message: 'Too many wrong attempts. Account locked for 24 hours.' });
      }
      user.otp = null; user.otpExpiry = null;
      await user.save();
      return res.status(400).json({ success: false, message: `Invalid OTP. Please request a new OTP.`, invalidated: true });
    }

    user.username = username;
    user.otp = null;
    user.otpExpiry = null;
    user.otpAttempts = 0;
    await user.save();

    const token = generateToken(user._id);
    res.json({
      success: true, token,
      user: { _id: user._id, mobile: user.mobile, username: user.username, role: user.role, teamId: user.teamId, avatar: user.avatar },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── POST /api/auth/register/send-otp (REGISTRATION flow) ───────────────────
const registerSendOTP = async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile) return res.status(400).json({ success: false, message: 'Mobile is required' });

    let user = await User.findOne({ mobile });

    // If fully registered (not a temp Player_ account)
    if (user && user.username && !user.username.startsWith('Player_')) {
      return res.status(400).json({ success: false, message: 'Account already exists. Please login instead.' });
    }

    if (user && isLocked(user)) return res.status(403).json({ success: false, message: lockInfo(user) });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MS);

    if (!user) {
      user = await User.create({ mobile, username: `User_${mobile.slice(-4)}`, otp, otpExpiry, otpAttempts: 0, role: 'user' });
    } else {
      user.otp = otp;
      user.otpExpiry = otpExpiry;
      user.otpAttempts = 0;
      await user.save();
    }

    console.log(`📱 Register OTP for ${mobile}: ${otp}`);
    res.json({ success: true, message: 'OTP sent', otp });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── GET /api/auth/me ────────────────────────────────────────────────────────// GET /api/auth/me
const getMe = async (req, res) => {
  const user = await User.findById(req.user._id)
    .populate('activeTeamId', 'name balance code')
    .populate('teams.teamId', 'name code');
  res.json({ success: true, user });
};

// ─── PATCH /api/auth/profile ─────────────────────────────────────────────────
const updateProfile = async (req, res) => {
  const { username, avatar } = req.body;
  const user = await User.findByIdAndUpdate(req.user._id, { username, avatar }, { new: true }).select('-otp -otpExpiry -otpAttempts -otpLockedUntil');
  res.json({ success: true, user });
};

// ─── PATCH /api/auth/settings ────────────────────────────────────────────────
const updateSettings = async (req, res) => {
  try {
    const { upiId, qrCode, notificationPrefs, privacySettings } = req.body;
    const updateData = {};
    if (upiId !== undefined) updateData.upiId = upiId;
    if (qrCode !== undefined) updateData.qrCode = qrCode;
    if (notificationPrefs) updateData.notificationPrefs = notificationPrefs;
    if (privacySettings) updateData.privacySettings = privacySettings;

    const user = await User.findByIdAndUpdate(req.user._id, { $set: updateData }, { new: true })
      .select('-otp -otpExpiry -otpAttempts -otpLockedUntil');
    res.json({ success: true, user, message: 'Settings updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── DELETE /api/auth/account ────────────────────────────────────────────────// DELETE /api/auth/account
const deleteAccount = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Remove user from all teams they belong to
    const teamIds = (user.teams || []).map(t => t.teamId);
    await Team.updateMany(
      { _id: { $in: teamIds } },
      { $pull: { players: userId, managers: userId, pendingRequests: userId } }
    );

    await User.findByIdAndDelete(userId);
    res.json({ success: true, message: 'Account deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = { sendOTP, resendOTP, verifyOTP, register, registerSendOTP, getMe, updateProfile, updateSettings, deleteAccount };
