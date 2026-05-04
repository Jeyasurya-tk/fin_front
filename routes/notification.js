const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getNotifications, markRead, getUnreadCount } = require('../controllers/notificationController');

router.get('/', protect, getNotifications);
router.patch('/read', protect, markRead);
router.get('/unread-count', protect, getUnreadCount);

module.exports = router;
