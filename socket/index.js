const Message = require('../models/Message');

const initSocket = (io) => {
  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    // Join team room
    socket.on('join_team', (teamId) => {
      socket.join(teamId);
      console.log(`Socket ${socket.id} joined team room: ${teamId}`);
    });

    // Real-time chat message
    socket.on('send_message', async (data) => {
      try {
        const { teamId, senderId, senderName, message } = data;
        const msg = await Message.create({ teamId, senderId, senderName, message, type: 'text' });
        const populated = await msg.populate('senderId', 'username avatar');
        io.to(teamId).emit('new_message', populated);
      } catch (err) {
        console.error('Socket message error:', err.message);
      }
    });

    // Typing indicator
    socket.on('typing', (data) => {
      socket.to(data.teamId).emit('user_typing', { username: data.username });
    });

    socket.on('stop_typing', (data) => {
      socket.to(data.teamId).emit('user_stop_typing', { username: data.username });
    });

    socket.on('disconnect', () => {
      console.log(`⚡ Socket disconnected: ${socket.id}`);
    });
  });
};

module.exports = initSocket;
