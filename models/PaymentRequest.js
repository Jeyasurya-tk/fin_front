const mongoose = require('mongoose');

// One document per payment session (one per match day)
// Manager creates this, sets dueAmount for the day, selects players present
const paymentRequestSchema = new mongoose.Schema({
  teamId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:      { type: Date, default: Date.now },
  dueAmount: { type: Number, required: true },  // ₹ per player — set per match day
  notes:     { type: String, default: '' },
  isActive:  { type: Boolean, default: true },

  players: [{
    userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Status flow: pending → player_marked (by player) OR cash_paid (by manager)
    //              → verified OR rejected (by manager)
    status: {
      type: String,
      enum: ['pending', 'cash_paid', 'player_marked', 'verified', 'rejected'],
      default: 'pending',
    },
    paidAmount:  { type: Number, default: 0 },
    paymentMode: { type: String, enum: ['upi', 'cash'], default: 'upi' },
    utrNumber:   { type: String, default: '' },
    markedAt:    { type: Date, default: null },
    verifiedAt:  { type: Date, default: null },
    verifiedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectionNote: { type: String, default: '' },
  }],
}, { timestamps: true });

module.exports = mongoose.model('PaymentRequest', paymentRequestSchema);
