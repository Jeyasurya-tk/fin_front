const User = require('../models/User');
const Team = require('../models/Team');
const Payment = require('../models/Payment');
const PaymentRequest = require('../models/PaymentRequest');
const Expense = require('../models/Expense');
const PlayerLedger = require('../models/PlayerLedger');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const Balance = require('../models/Balance');

const resetDatabase = async (req, res) => {
  // Ensure the user is an admin globally
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Forbidden: Admins only' });
  }

  try {
    await Team.deleteMany({});
    await Payment.deleteMany({});
    await PaymentRequest.deleteMany({});
    await Expense.deleteMany({});
    await PlayerLedger.deleteMany({});
    await Message.deleteMany({});
    await Notification.deleteMany({});
    await Balance.deleteMany({});
    
    // Delete all non-admin users so the admin can still log in
    await User.deleteMany({ role: { $ne: 'admin' } });

    // Reset the admin's teams arrays since teams are gone
    await User.updateMany({ role: 'admin' }, { $set: { teams: [], activeTeamId: null } });

    res.json({ success: true, message: 'Database reset successfully. Only admin accounts remain.' });
  } catch (error) {
    console.error('Reset DB error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset database' });
  }
};

module.exports = { resetDatabase };
