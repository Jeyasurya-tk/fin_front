const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  teamId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentRequest', default: null }, // linked session
  amount:    { type: Number, required: true },
  paymentMode: { type: String, enum: ['cash', 'upi'], default: 'cash' },
  paymentType: { type: String, enum: ['full', 'partial', 'advance'], default: 'full' },
  status:    { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
  description:    { type: String, default: '' },
  utrNumber:      { type: String, default: '' },
  isManagerEntry: { type: Boolean, default: false }, // true when manager marks cash directly
  verifiedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  verifiedAt:  { type: Date, default: null },
  rejectedAt:  { type: Date, default: null },
  date:        { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);
