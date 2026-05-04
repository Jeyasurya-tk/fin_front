const Message = require('../models/Message');

const getMessages = async (req, res) => {
  const messages = await Message.find({ teamId: req.user.activeTeamId })
    .populate('senderId', 'username avatar')
    .sort({ createdAt: 1 })
    .limit(200);
  res.json({ success: true, messages });
};

const sendMessage = async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ success: false, message: 'Message required' });

  const msg = await Message.create({
    teamId: req.user.activeTeamId,
    senderId: req.user._id,
    senderName: req.user.username,
    message,
    type: 'text',
  });

  const populated = await Message.findById(msg._id).populate('senderId', 'username avatar');
  req.io.to(req.user.activeTeamId.toString()).emit('new_message', populated);
  res.status(201).json({ success: true, message: populated });
};

module.exports = { getMessages, sendMessage };
