const Balance = require('../models/Balance');
const Team = require('../models/Team');

// POST /api/balance/add
const addBalance = async (req, res) => {
  const { amount, type, description, date } = req.body;
  if (!amount) return res.status(400).json({ success: false, message: 'Amount required' });

  const team = await Team.findById(req.user.teamId);
  if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

  const isMgr = team.managers.map(String).includes(req.user._id.toString()) || team.adminId.toString() === req.user._id.toString();
  if (!isMgr) return res.status(403).json({ success: false, message: 'Only managers can modify balance' });

  const entry = await Balance.create({ teamId: team._id, addedBy: req.user._id, amount: Number(amount), type: type || 'credit', description, date: date || new Date() });

  if (type === 'debit') {
    team.balance -= Number(amount);
  } else {
    team.balance += Number(amount);
  }
  await team.save();

  req.io.to(team._id.toString()).emit('balance_updated', { balance: team.balance, entry });
  res.status(201).json({ success: true, entry, teamBalance: team.balance });
};

// GET /api/balance
const getBalanceHistory = async (req, res) => {
  const history = await Balance.find({ teamId: req.user.teamId }).populate('addedBy', 'username').sort({ createdAt: -1 });
  res.json({ success: true, history });
};

module.exports = { addBalance, getBalanceHistory };
