const Payment = require('../models/Payment');
const PaymentRequest = require('../models/PaymentRequest');
const PlayerLedger = require('../models/PlayerLedger');
const Team = require('../models/Team');
const Notification = require('../models/Notification');
const Message = require('../models/Message');

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Upsert a player's ledger and recalculate balances
const updateLedger = async (userId, teamId, { addDue = 0, addPaid = 0 }) => {
  const ledger = await PlayerLedger.findOneAndUpdate(
    { userId, teamId },
    { $inc: { totalDue: addDue, totalPaid: addPaid }, lastUpdated: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Recalculate derived fields
  const gross = ledger.totalPaid - ledger.totalDue;
  ledger.pendingAmount  = gross < 0 ? Math.abs(gross) : 0;
  ledger.advanceBalance = gross > 0 ? gross : 0;
  await ledger.save();
  return ledger;
};

// Check if user is manager of the active team
const assertManager = async (user, team) => {
  if (!team) throw { status: 404, message: 'Team not found' };
  const isMgr = team.managers.map(String).includes(user._id.toString());
  const isCreator = team.createdBy?.toString() === user._id.toString();
  if (!isMgr && !isCreator) throw { status: 403, message: 'Only managers can do this' };
};

const notify = async (io, { userId, teamId, title, message, type = 'payment', referenceId }) => {
  await Notification.create({ userId, teamId, title, message, type, referenceId });
  if (io) io.to(teamId.toString()).emit('notification', { userId, title, message });
};

// ─── POST /api/payment/request ─────────────────────────────────────────────
// Manager creates a payment request for the day
const createPaymentRequest = async (req, res) => {
  try {
    const { dueAmount, playerIds, notes, date, cashPaidUserIds = [] } = req.body;
    if (!dueAmount || !playerIds?.length) {
      return res.status(400).json({ success: false, message: 'dueAmount and at least one player required' });
    }

    const team = await Team.findById(req.user.activeTeamId);
    await assertManager(req.user, team);

    let totalCashCollected = 0;
    const paymentRecordsToCreate = [];

    // Build player entries — check advance balance to auto-adjust effective due
    const playerEntries = await Promise.all(playerIds.map(async (uid) => {
      const isCashPaid = cashPaidUserIds.includes(uid);
      
      // Increase totalDue for each player, and totalPaid if they paid cash immediately
      await updateLedger(uid, team._id, { addDue: dueAmount, addPaid: isCashPaid ? dueAmount : 0 });
      
      if (isCashPaid) {
        totalCashCollected += Number(dueAmount);
        paymentRecordsToCreate.push({
          userId: uid, teamId: team._id,
          amount: Number(dueAmount), paymentMode: 'cash',
          paymentType: 'full', status: 'verified', isManagerEntry: true,
          verifiedBy: req.user._id, verifiedAt: new Date(),
          description: `Cash collected at request creation`,
        });
        return { 
          userId: uid, status: 'verified', paidAmount: dueAmount, 
          paymentMode: 'cash', markedAt: new Date(), verifiedAt: new Date(), verifiedBy: req.user._id 
        };
      } else {
        return { userId: uid, status: 'pending', paidAmount: 0 };
      }
    }));

    const request = await PaymentRequest.create({
      teamId: team._id,
      createdBy: req.user._id,
      date: date ? new Date(date) : new Date(),
      dueAmount,
      notes,
      players: playerEntries,
    });

    if (paymentRecordsToCreate.length > 0) {
      paymentRecordsToCreate.forEach(p => p.requestId = request._id);
      await Payment.insertMany(paymentRecordsToCreate);
      
      await Team.findByIdAndUpdate(team._id, {
        $inc: { balance: totalCashCollected, totalCollected: totalCashCollected },
      });
    }

    // Notify each player
    await Promise.all(playerIds.map(uid => {
      const isCashPaid = cashPaidUserIds.includes(uid);
      if (isCashPaid) {
        return notify(req.io, { userId: uid, teamId: team._id, title: '✅ Cash Payment Recorded', message: `₹${dueAmount} cash payment recorded for today's match.`, type: 'payment', referenceId: request._id });
      } else {
        const ledger_prom = PlayerLedger.findOne({ userId: uid, teamId: team._id });
        return ledger_prom.then(ledger => {
          const advance = ledger?.advanceBalance || 0;
          const effective = Math.max(0, dueAmount - advance);
          const msg = effective === 0
            ? `Your advance balance covers today's ₹${dueAmount} fee for ${team.name}. ✅`
            : `Please pay ₹${effective} for today's match (${team.name}). Due: ₹${dueAmount}${advance > 0 ? `, advance credit: ₹${advance}` : ''}.`;
          return notify(req.io, { userId: uid, teamId: team._id, title: '💰 Payment Due', message: msg, type: 'payment', referenceId: request._id });
        });
      }
    }));

    // System chat message
    let chatMessage = `📋 ${req.user.username} created a payment request: ₹${dueAmount} due from ${playerIds.length} players.`;
    if (totalCashCollected > 0) chatMessage += ` (₹${totalCashCollected} collected in cash)`;
    
    await Message.create({
      teamId: team._id,
      message: chatMessage,
      type: 'system', senderName: 'System',
    });

    const populated = await PaymentRequest.findById(request._id)
      .populate('players.userId', 'username mobile avatar')
      .populate('createdBy', 'username');

    req.io.to(team._id.toString()).emit('payment_request_created', populated);
    res.status(201).json({ success: true, request: populated });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/payment/request/:requestId/cash ─────────────────────────────
// Manager marks a specific player as paid in cash (skip player-marked step)
const markCashPayment = async (req, res) => {
  try {
    const { userId, amount } = req.body;
    const team = await Team.findById(req.user.activeTeamId);
    await assertManager(req.user, team);

    const request = await PaymentRequest.findOne({ _id: req.params.requestId, teamId: team._id });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    const playerEntry = request.players.find(p => p.userId.toString() === userId);
    if (!playerEntry) return res.status(404).json({ success: false, message: 'Player not in this request' });
    if (['verified', 'cash_paid'].includes(playerEntry.status)) {
      return res.status(400).json({ success: false, message: 'Already marked' });
    }

    const paidAmount = Number(amount) || request.dueAmount;

    // Update the player entry in the request
    playerEntry.status      = 'verified';   // cash → immediately verified
    playerEntry.paidAmount  = paidAmount;
    playerEntry.paymentMode = 'cash';
    playerEntry.markedAt    = new Date();
    playerEntry.verifiedAt  = new Date();
    playerEntry.verifiedBy  = req.user._id;
    await request.save();

    // Create a Payment record
    const payment = await Payment.create({
      userId, teamId: team._id,
      requestId: request._id,
      amount: paidAmount, paymentMode: 'cash',
      paymentType: paidAmount >= request.dueAmount ? 'full' : 'partial',
      status: 'verified', isManagerEntry: true,
      verifiedBy: req.user._id, verifiedAt: new Date(),
      description: `Cash collected by ${req.user.username}`,
    });

    // Update team balance
    await Team.findByIdAndUpdate(team._id, {
      $inc: { balance: paidAmount, totalCollected: paidAmount },
    });

    // Update ledger
    const ledger = await updateLedger(userId, team._id, { addPaid: paidAmount });

    // Notify player
    await notify(req.io, {
      userId, teamId: team._id, title: '✅ Cash Payment Recorded',
      message: `₹${paidAmount} cash payment recorded by ${req.user.username}. ${ledger.pendingAmount > 0 ? `₹${ledger.pendingAmount} still pending.` : 'You\'re all paid up! 🎉'}`,
      referenceId: payment._id,
    });

    await Message.create({
      teamId: team._id,
      message: `💵 Cash payment of ₹${paidAmount} collected from player by ${req.user.username}`,
      type: 'system', senderName: 'System',
    });

    const populated = await PaymentRequest.findById(request._id)
      .populate('players.userId', 'username mobile avatar');
    req.io.to(team._id.toString()).emit('payment_request_updated', populated);
    res.json({ success: true, request: populated, ledger });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/payment/mark-done ─────────────────────────────────────────────
// Player marks their own payment as done (after UPI transfer)
const playerMarkDone = async (req, res) => {
  try {
    const { requestId, amount, paymentMode, utrNumber } = req.body;
    if (!requestId || !amount) return res.status(400).json({ success: false, message: 'requestId and amount required' });

    const request = await PaymentRequest.findById(requestId);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    const playerEntry = request.players.find(p => p.userId.toString() === req.user._id.toString());
    if (!playerEntry) return res.status(403).json({ success: false, message: 'You are not in this payment request' });
    if (['verified', 'cash_paid', 'player_marked'].includes(playerEntry.status)) {
      return res.status(400).json({ success: false, message: 'Already marked. Awaiting manager verification.' });
    }

    playerEntry.status      = 'player_marked';
    playerEntry.paidAmount  = Number(amount);
    playerEntry.paymentMode = paymentMode || 'upi';
    playerEntry.utrNumber   = utrNumber || '';
    playerEntry.markedAt    = new Date();
    await request.save();

    // Create pending Payment record
    const payment = await Payment.create({
      userId: req.user._id, teamId: request.teamId,
      requestId: request._id,
      amount: Number(amount), paymentMode: paymentMode || 'upi',
      paymentType: Number(amount) >= request.dueAmount ? 'full' : 'partial',
      status: 'pending', utrNumber,
      description: `Player self-marked via ${paymentMode || 'upi'}`,
    });

    // Notify managers
    const team = await Team.findById(request.teamId);
    const managers = [...(team.managers || [])];
    await Promise.all(managers.map(mgr =>
      notify(req.io, {
        userId: mgr, teamId: request.teamId,
        title: '🔔 Payment Marked Done',
        message: `${req.user.username} marked ₹${amount} payment as done (${paymentMode || 'upi'}). Please verify.`,
        referenceId: request._id,
      })
    ));

    await Message.create({
      teamId: request.teamId,
      message: `📱 ${req.user.username} marked payment of ₹${amount} as done — awaiting manager verification`,
      type: 'system', senderName: 'System',
    });

    const populated = await PaymentRequest.findById(request._id)
      .populate('players.userId', 'username mobile avatar');
    req.io.to(request.teamId.toString()).emit('payment_request_updated', populated);
    res.json({ success: true, request: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PATCH /api/payment/verify ───────────────────────────────────────────────
// Manager verifies ✅ or rejects ❌ a player_marked payment
const verifyPayment = async (req, res) => {
  try {
    const { requestId, userId, action, rejectionNote } = req.body;
    // action: 'verified' | 'rejected'
    const team = await Team.findById(req.user.activeTeamId);
    await assertManager(req.user, team);

    const request = await PaymentRequest.findOne({ _id: requestId, teamId: team._id });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    const playerEntry = request.players.find(p => p.userId.toString() === userId);
    if (!playerEntry) return res.status(404).json({ success: false, message: 'Player not in request' });
    if (playerEntry.status !== 'player_marked') {
      return res.status(400).json({ success: false, message: 'No pending mark to verify' });
    }

    playerEntry.status     = action;   // 'verified' or 'rejected'
    playerEntry.verifiedAt = new Date();
    playerEntry.verifiedBy = req.user._id;
    if (rejectionNote) playerEntry.rejectionNote = rejectionNote;
    await request.save();

    // Update the Payment record
    await Payment.findOneAndUpdate(
      { requestId: request._id, userId, status: 'pending' },
      {
        status: action,
        verifiedBy: req.user._id,
        ...(action === 'verified' ? { verifiedAt: new Date() } : { rejectedAt: new Date() }),
      }
    );

    let ledger;
    if (action === 'verified') {
      const paidAmount = playerEntry.paidAmount;
      // Update team balance
      await Team.findByIdAndUpdate(team._id, { $inc: { balance: paidAmount, totalCollected: paidAmount } });
      // Update ledger
      ledger = await updateLedger(userId, team._id, { addPaid: paidAmount });

      // Notify player
      const completionMsg = ledger.pendingAmount === 0
        ? `₹${paidAmount} payment verified! 🎉 You're all paid up.`
        : `₹${paidAmount} payment verified! ₹${ledger.pendingAmount} still pending.`;
      await notify(req.io, { userId, teamId: team._id, title: '✅ Payment Verified', message: completionMsg, referenceId: request._id });

      await Message.create({
        teamId: team._id,
        message: `✅ ₹${paidAmount} payment from player verified by ${req.user.username}. Team balance: ₹${(await Team.findById(team._id)).balance}`,
        type: 'system', senderName: 'System',
      });
    } else {
      // Rejected — notify player with exact amount due
      const ledgerData = await PlayerLedger.findOne({ userId, teamId: team._id });
      const stillDue = ledgerData?.pendingAmount || request.dueAmount;
      await notify(req.io, {
        userId, teamId: team._id, title: '❌ Payment Not Received',
        message: `Your payment was not confirmed by the manager. Please pay ₹${stillDue} for ${team.name}.`,
        referenceId: request._id,
      });

      await Message.create({
        teamId: team._id,
        message: `❌ Payment from player rejected by ${req.user.username}${rejectionNote ? `: ${rejectionNote}` : ''}`,
        type: 'system', senderName: 'System',
      });
    }

    const populated = await PaymentRequest.findById(request._id)
      .populate('players.userId', 'username mobile avatar')
      .populate('players.verifiedBy', 'username');
    req.io.to(team._id.toString()).emit('payment_request_updated', populated);
    res.json({ success: true, request: populated, ledger });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/payment/requests ────────────────────────────────────────────────
const getPaymentRequests = async (req, res) => {
  try {
    const teamId = req.user.activeTeamId;
    const { limit = 20, page = 1 } = req.query;
    const requests = await PaymentRequest.find({ teamId })
      .sort({ date: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
      .populate('players.userId', 'username mobile avatar')
      .populate('createdBy', 'username');
    res.json({ success: true, requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/payment/requests/my ─────────────────────────────────────────────
// Player: get only requests that include them
const getMyRequests = async (req, res) => {
  try {
    const teamId = req.user.activeTeamId;
    const requests = await PaymentRequest.find({
      teamId,
      'players.userId': req.user._id,
    })
      .sort({ date: -1 })
      .limit(30)
      .populate('players.userId', 'username mobile avatar')
      .populate('createdBy', 'username');
    res.json({ success: true, requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/payment/ledger ──────────────────────────────────────────────────
// Manager: all player ledgers for the active team
const getAllLedgers = async (req, res) => {
  try {
    const team = await Team.findById(req.user.activeTeamId);
    await assertManager(req.user, team);
    const ledgers = await PlayerLedger.find({ teamId: team._id })
      .populate('userId', 'username mobile avatar');
    res.json({ success: true, ledgers });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/payment/ledger/me ───────────────────────────────────────────────
// Player: own ledger
const getMyLedger = async (req, res) => {
  try {
    const ledger = await PlayerLedger.findOne({ userId: req.user._id, teamId: req.user.activeTeamId });
    res.json({ success: true, ledger: ledger || { totalDue: 0, totalPaid: 0, pendingAmount: 0, advanceBalance: 0 } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/payment (legacy + new combined list) ────────────────────────────
const getPayments = async (req, res) => {
  try {
    const { date, status, userId } = req.query;
    const filter = { teamId: req.user.activeTeamId };
    if (status) filter.status = status;
    if (userId) filter.userId = userId;
    if (date) {
      const start = new Date(date); start.setHours(0, 0, 0, 0);
      const end   = new Date(date); end.setHours(23, 59, 59, 999);
      filter.date = { $gte: start, $lte: end };
    }
    const payments = await Payment.find(filter)
      .populate('userId', 'username mobile avatar')
      .populate('verifiedBy', 'username')
      .sort({ createdAt: -1 });
    res.json({ success: true, payments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/payment/summary ─────────────────────────────────────────────────
const getPaymentSummary = async (req, res) => {
  try {
    const teamId = req.user.activeTeamId;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

    const [todayPayments, allPayments, team, todayRequest] = await Promise.all([
      Payment.find({ teamId, status: 'verified', date: { $gte: today, $lte: todayEnd } }),
      Payment.find({ teamId, status: 'verified' }),
      Team.findById(teamId),
      PaymentRequest.findOne({ teamId, date: { $gte: today, $lte: todayEnd } })
        .populate('players.userId', 'username'),
    ]);

    const todayCollection  = todayPayments.reduce((s, p) => s + p.amount, 0);
    const totalCollected   = allPayments.reduce((s, p) => s + p.amount, 0);

    // Today's pending players
    const pendingPlayers = todayRequest?.players.filter(p => ['pending', 'player_marked'].includes(p.status)) || [];

    res.json({
      success: true,
      summary: {
        todayCollection, totalCollected,
        teamBalance: team?.balance || 0,
        totalExpenses: team?.totalExpenses || 0,
        todayPendingCount: pendingPlayers.length,
        todayRequest: todayRequest || null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/payment (legacy — direct add by player, no request) ────────────
const addPayment = async (req, res) => {
  try {
    const { amount, paymentMode, paymentType, description, utrNumber } = req.body;
    if (!amount) return res.status(400).json({ success: false, message: 'Amount required' });

    const team = await Team.findById(req.user.activeTeamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found. Select an active team first.' });

    const payment = await Payment.create({
      userId: req.user._id, teamId: team._id,
      amount: Number(amount), paymentMode: paymentMode || 'cash',
      paymentType: paymentType || 'full', description, utrNumber, status: 'pending',
    });

    // Notify managers
    await Promise.all(team.managers.map(uid =>
      Notification.create({ userId: uid, teamId: team._id, title: 'Payment Submitted', message: `${req.user.username} submitted ₹${amount} payment`, type: 'payment', referenceId: payment._id })
    ));

    await Message.create({ teamId: team._id, message: `💰 ${req.user.username} submitted a payment of ₹${amount} (${paymentMode}) — Pending verification`, type: 'system', senderName: 'System' });
    const populated = await Payment.findById(payment._id).populate('userId', 'username mobile avatar');
    req.io.to(team._id.toString()).emit('payment_added', populated);
    res.status(201).json({ success: true, payment: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createPaymentRequest,
  markCashPayment,
  playerMarkDone,
  verifyPayment,
  getPaymentRequests,
  getMyRequests,
  getAllLedgers,
  getMyLedger,
  getPayments,
  getPaymentSummary,
  addPayment,
};
