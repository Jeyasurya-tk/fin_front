const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, unique: true, uppercase: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // original creator = manager
  managers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  players: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  pendingRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  playerAliases: { type: Map, of: String, default: {} },
  qrCode: { type: String, default: '' },
  balance: { type: Number, default: 0 },
  totalCollected: { type: Number, default: 0 },
  totalExpenses: { type: Number, default: 0 },
  upiId: { type: String, default: '' },
  description: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Team', teamSchema);
