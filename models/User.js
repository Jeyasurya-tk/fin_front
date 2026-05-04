const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  mobile: { type: String, required: true, unique: true, trim: true },
  username: { type: String, required: true, trim: true },

  // Global role: only 'admin' is special. 'user' is the default for everyone.
  // Manager/Player roles are team-scoped — stored in the `teams` array below.
  role: { type: String, enum: ['admin', 'user'], default: 'user' },

  // Multi-team support: each entry stores which team and what role within it
  teams: [{
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    role:   { type: String, enum: ['manager', 'player'], default: 'player' },
  }],

  // Active/selected team (used for single-team context in requests)
  activeTeamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },

  avatar: { type: String, default: '' },

  // OTP fields
  otp:            { type: String, default: null },
  otpExpiry:      { type: Date,   default: null },
  otpAttempts:    { type: Number, default: 0 },
  otpLockedUntil: { type: Date,   default: null },

  // Payment settings
  upiId:  { type: String, default: '' },
  qrCode: { type: String, default: '' },

  // Notification preferences
  notificationPrefs: {
    paymentPendingAlerts:   { type: Boolean, default: true },
    paymentReceivedConfirm: { type: Boolean, default: true },
    joinRequestAlerts:      { type: Boolean, default: true },
    adminMessages:          { type: Boolean, default: true },
    paymentReminders:       { type: Boolean, default: true },
    expenseUpdates:         { type: Boolean, default: true },
    chatNotifications:      { type: Boolean, default: true },
  },

  // Privacy settings
  privacySettings: {
    paymentVisibility: { type: String, enum: ['everyone', 'manager_only'], default: 'everyone' },
  },

  isActive: { type: Boolean, default: true },
}, { timestamps: true });

// Virtual: get role in a specific team
userSchema.methods.getRoleInTeam = function (teamId) {
  const entry = this.teams.find(t => t.teamId.toString() === teamId.toString());
  return entry ? entry.role : null;
};

// Virtual: is the user a manager in a given team?
userSchema.methods.isManagerOf = function (teamId) {
  return this.getRoleInTeam(teamId) === 'manager';
};

module.exports = mongoose.model('User', userSchema);
