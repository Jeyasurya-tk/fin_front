const mongoose = require('mongoose');

// One document per (userId + teamId) pair — upserted on every payment event
// Acts as the player's running financial ledger within a team
const playerLedgerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },

  totalDue:       { type: Number, default: 0 },   // sum of all request dueAmounts for this player
  totalPaid:      { type: Number, default: 0 },   // sum of all verified payments
  pendingAmount:  { type: Number, default: 0 },   // totalDue - totalPaid (floored at 0)
  advanceBalance: { type: Number, default: 0 },   // credit carried forward when paid > due

  lastUpdated: { type: Date, default: Date.now },
}, { timestamps: true });

// Ensure uniqueness — one ledger per player per team
playerLedgerSchema.index({ userId: 1, teamId: 1 }, { unique: true });

module.exports = mongoose.model('PlayerLedger', playerLedgerSchema);
