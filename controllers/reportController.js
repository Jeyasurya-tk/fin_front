const Payment = require('../models/Payment');
const Expense = require('../models/Expense');
const Team = require('../models/Team');
const User = require('../models/User');

// GET /api/report/daily
const getDailyReport = async (req, res) => {
  const { date } = req.query;
  const teamId = req.user.activeTeamId;
  const start = new Date(date || new Date()); start.setHours(0, 0, 0, 0);
  const end = new Date(date || new Date()); end.setHours(23, 59, 59, 999);

  const [payments, expenses, team] = await Promise.all([
    Payment.find({ teamId, date: { $gte: start, $lte: end } }).populate('userId', 'username mobile'),
    Expense.find({ teamId, date: { $gte: start, $lte: end } }).populate('addedBy', 'username'),
    Team.findById(teamId),
  ]);

  const totalCollected = payments.filter(p => p.status === 'verified').reduce((s, p) => s + p.amount, 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const pendingAmount = payments.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0);

  res.json({
    success: true,
    report: {
      date: start,
      teamName: team?.name,
      teamBalance: team?.balance,
      totalCollected,
      totalExpenses,
      pendingAmount,
      netCollection: totalCollected - totalExpenses,
      payments,
      expenses,
    },
  });
};

// GET /api/report/full
const getFullReport = async (req, res) => {
  const teamId = req.user.activeTeamId;
  const [payments, expenses, team] = await Promise.all([
    Payment.find({ teamId }).populate('userId', 'username mobile').sort({ createdAt: -1 }),
    Expense.find({ teamId }).populate('addedBy', 'username').sort({ createdAt: -1 }),
    Team.findById(teamId).populate('players', 'username mobile'),
  ]);
  const members = team?.players || [];

  const verified = payments.filter(p => p.status === 'verified');
  const totalCollected = verified.reduce((s, p) => s + p.amount, 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

  // Per-player summary
  const playerSummary = members.map(m => {
    const playerPayments = verified.filter(p => p.userId?._id.toString() === m._id.toString());
    return {
      player: m,
      totalPaid: playerPayments.reduce((s, p) => s + p.amount, 0),
      count: playerPayments.length,
    };
  });

  res.json({
    success: true,
    report: {
      teamName: team?.name,
      teamBalance: team?.balance,
      totalCollected,
      totalExpenses,
      totalMembers: members.length,
      playerSummary,
      payments,
      expenses,
    },
  });
};

module.exports = { getDailyReport, getFullReport };
