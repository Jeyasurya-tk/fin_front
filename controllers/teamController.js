const Team = require('../models/Team');
const User = require('../models/User');
const Notification = require('../models/Notification');
const crypto = require('crypto');

const generateCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();

// ─── POST /api/team/create ────────────────────────────────────────────────────
// Any user can create a team. Creator becomes manager of that team.
// A user can create (and belong to) multiple teams.
const createTeam = async (req, res) => {
  try {
    const { name, description, upiId } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Team name required' });

    const code = generateCode();
    const team = await Team.create({
      name,
      description,
      upiId,
      createdBy: req.user._id,
      managers:  [req.user._id],
      players:   [req.user._id],
      code,
    });

    // Add this team to user's teams[] as manager
    await User.findByIdAndUpdate(req.user._id, {
      $push: { teams: { teamId: team._id, role: 'manager' } },
      $set:  { activeTeamId: team._id },
    });

    const updatedTeam = await Team.findById(team._id)
      .populate('players managers', 'username mobile avatar');

    res.status(201).json({ success: true, team: updatedTeam });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/team/join ──────────────────────────────────────────────────────
// User joins via code → player role pending manager approval
const joinTeam = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Team code required' });

    const team = await Team.findOne({ code: code.toUpperCase() });
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    // Check if already a member of this specific team
    const alreadyMember = req.user.teams?.some(t => t.teamId.toString() === team._id.toString());
    if (alreadyMember) return res.status(400).json({ success: false, message: 'You are already in this team' });

    const alreadyPending = team.pendingRequests.map(String).includes(req.user._id.toString());
    if (alreadyPending) return res.status(400).json({ success: false, message: 'Request already sent' });

    team.pendingRequests.push(req.user._id);
    await team.save();

    // Notify managers
    const notifyUsers = [...team.managers, team.createdBy];
    const uniqueNotify = [...new Set(notifyUsers.map(String))];
    await Promise.all(uniqueNotify.map(uid =>
      Notification.create({
        userId: uid, teamId: team._id,
        title: 'Join Request',
        message: `${req.user.username} wants to join ${team.name}`,
        type: 'team',
      })
    ));

    res.json({ success: true, message: 'Join request sent' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/team/approve ───────────────────────────────────────────────────
const approveRequest = async (req, res) => {
  try {
    const { userId, action } = req.body;
    const team = await Team.findById(req.user.activeTeamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    const isManager = team.managers.map(String).includes(req.user._id.toString());
    const isCreator = team.createdBy.toString() === req.user._id.toString();
    if (!isManager && !isCreator) {
      return res.status(403).json({ success: false, message: 'Only managers can approve' });
    }

    team.pendingRequests = team.pendingRequests.filter(id => id.toString() !== userId);

    if (action === 'approve') {
      if (!team.players.map(String).includes(userId)) team.players.push(userId);

      // Add this team to the joining user's teams[] as player
      await User.findByIdAndUpdate(userId, {
        $push: { teams: { teamId: team._id, role: 'player' } },
        $set:  { activeTeamId: team._id },
      });

      await Notification.create({
        userId, teamId: team._id,
        title: 'Request Approved!',
        message: `You've been approved to join ${team.name}`,
        type: 'team',
      });
    } else {
      await Notification.create({
        userId, teamId: team._id,
        title: 'Request Rejected',
        message: `Your request to join ${team.name} was rejected`,
        type: 'team',
      });
    }

    await team.save();
    const updatedTeam = await Team.findById(team._id)
      .populate('players managers pendingRequests', 'username mobile avatar');
    res.json({ success: true, team: updatedTeam });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/team/my ─────────────────────────────────────────────────────────
const getMyTeam = async (req, res) => {
  try {
    if (!req.user.activeTeamId) return res.status(404).json({ success: false, message: 'No active team' });
    const team = await Team.findById(req.user.activeTeamId)
      .populate('players managers pendingRequests createdBy', 'username mobile avatar createdAt');
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });
    res.json({ success: true, team });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/team/all ────────────────────────────────────────────────────────
// List all teams the user belongs to
const getMyTeams = async (req, res) => {
  try {
    const teamIds = (req.user.teams || []).map(t => t.teamId);
    const teams = await Team.find({ _id: { $in: teamIds } })
      .select('name code balance description createdAt')
      .lean();

    // Attach user's role in each team
    const result = teams.map(t => ({
      ...t,
      myRole: req.user.teams.find(ut => ut.teamId.toString() === t._id.toString())?.role || 'player',
    }));

    res.json({ success: true, teams: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PATCH /api/team/switch ───────────────────────────────────────────────────
// Switch active team
const switchTeam = async (req, res) => {
  try {
    const { teamId } = req.body;
    const isMember = req.user.teams?.some(t => t.teamId.toString() === teamId);
    if (!isMember) return res.status(403).json({ success: false, message: 'Not a member of this team' });

    await User.findByIdAndUpdate(req.user._id, { activeTeamId: teamId });
    const team = await Team.findById(teamId)
      .populate('players managers pendingRequests createdBy', 'username mobile avatar');
    res.json({ success: true, team });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PATCH /api/team/promote ──────────────────────────────────────────────────
// Manager promotes player → manager (or demotes back to player)
const promoteUser = async (req, res) => {
  try {
    const { userId, role } = req.body;
    const team = await Team.findById(req.user.activeTeamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    const isCreator = team.createdBy.toString() === req.user._id.toString();
    const isManager = team.managers.map(String).includes(req.user._id.toString());
    if (!isCreator && !isManager) {
      return res.status(403).json({ success: false, message: 'Only managers can change roles' });
    }

    if (role === 'manager') {
      if (!team.managers.map(String).includes(userId)) team.managers.push(userId);
    } else {
      team.managers = team.managers.filter(id => id.toString() !== userId);
    }

    // Update role in user's teams[] array
    await User.findOneAndUpdate(
      { _id: userId, 'teams.teamId': team._id },
      { $set: { 'teams.$.role': role } }
    );

    await team.save();
    const updatedTeam = await Team.findById(team._id)
      .populate('players managers pendingRequests createdBy', 'username mobile avatar');
    res.json({ success: true, team: updatedTeam });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/team/upload-qr ────────────────────────────────────────────────
const uploadQR = async (req, res) => {
  try {
    const team = await Team.findById(req.user.activeTeamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    team.qrCode = `/uploads/${req.file.filename}`;
    await team.save();
    res.json({ success: true, qrCode: team.qrCode });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/team/remove ───────────────────────────────────────────────────
const removePlayer = async (req, res) => {
  try {
    const { userId } = req.body;
    const team = await Team.findById(req.user.activeTeamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    const isCreator = team.createdBy.toString() === req.user._id.toString();
    const isManager = team.managers.map(String).includes(req.user._id.toString());
    if (!isCreator && !isManager) {
      return res.status(403).json({ success: false, message: 'Only managers can remove players' });
    }

    if (userId === team.createdBy.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot remove the creator' });
    }

    team.players = team.players.filter(id => id.toString() !== userId);
    team.managers = team.managers.filter(id => id.toString() !== userId);
    
    // Also remove alias if exists
    if (team.playerAliases && team.playerAliases.has(userId)) {
      team.playerAliases.delete(userId);
    }
    await team.save();

    await User.findByIdAndUpdate(userId, {
      $pull: { teams: { teamId: team._id } }
    });

    const updatedTeam = await Team.findById(team._id)
      .populate('players managers pendingRequests createdBy', 'username mobile avatar');
    res.json({ success: true, team: updatedTeam });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/team/alias ────────────────────────────────────────────────────
const updateAlias = async (req, res) => {
  try {
    const { userId, alias } = req.body;
    const team = await Team.findById(req.user.activeTeamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    const isCreator = team.createdBy.toString() === req.user._id.toString();
    const isManager = team.managers.map(String).includes(req.user._id.toString());
    if (!isCreator && !isManager) {
      return res.status(403).json({ success: false, message: 'Only managers can update aliases' });
    }

    if (!team.playerAliases) team.playerAliases = new Map();
    
    if (alias) {
      team.playerAliases.set(userId, alias);
    } else {
      team.playerAliases.delete(userId);
    }

    await team.save();

    const updatedTeam = await Team.findById(team._id)
      .populate('players managers pendingRequests createdBy', 'username mobile avatar');
    res.json({ success: true, team: updatedTeam });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createTeam, joinTeam, approveRequest, getMyTeam, getMyTeams, switchTeam, promoteUser, uploadQR, removePlayer, updateAlias };
