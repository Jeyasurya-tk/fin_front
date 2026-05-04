const Expense = require('../models/Expense');
const Team = require('../models/Team');
const Message = require('../models/Message');
const Notification = require('../models/Notification');

// POST /api/expense
const addExpense = async (req, res) => {
  const { category, amount, description, date } = req.body;
  if (!category || !amount) return res.status(400).json({ success: false, message: 'Category and amount required' });

  const team = await Team.findById(req.user.activeTeamId);
  if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

  const isMgr = team.managers.map(String).includes(req.user._id.toString());
  const isCreator = team.createdBy && team.createdBy.toString() === req.user._id.toString();
  if (!isMgr && !isCreator) return res.status(403).json({ success: false, message: 'Only managers can add expenses' });

  const expense = await Expense.create({ teamId: team._id, addedBy: req.user._id, category, amount: Number(amount), description, date: date || new Date() });

  team.balance -= Number(amount);
  team.totalExpenses += Number(amount);
  await team.save();

  await Message.create({ teamId: team._id, message: `🧾 Expense of ₹${amount} (${category}) added by ${req.user.username}. Team balance: ₹${team.balance}`, type: 'system', senderName: 'System' });

  // Notify all team members
  const allMembers = [...new Set([...team.players.map(String), ...team.managers.map(String)])];
  await Promise.all(allMembers.filter(uid => uid !== req.user._id.toString()).map(uid =>
    Notification.create({ userId: uid, teamId: team._id, title: 'Expense Added', message: `₹${amount} spent on ${category}`, type: 'expense', referenceId: expense._id })
  ));

  const populated = await Expense.findById(expense._id).populate('addedBy', 'username mobile');
  req.io.to(team._id.toString()).emit('expense_added', { expense: populated, teamBalance: team.balance });

  res.status(201).json({ success: true, expense: populated, teamBalance: team.balance });
};

// GET /api/expense
const getExpenses = async (req, res) => {
  const { date, category } = req.query;
  const filter = { teamId: req.user.activeTeamId };
  if (category) filter.category = category;
  if (date) {
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end = new Date(date); end.setHours(23, 59, 59, 999);
    filter.date = { $gte: start, $lte: end };
  }
  const expenses = await Expense.find(filter).populate('addedBy', 'username mobile').sort({ createdAt: -1 });
  res.json({ success: true, expenses });
};

module.exports = { addExpense, getExpenses };
