const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getMessages, sendMessage } = require('../controllers/chatController');

router.get('/', protect, getMessages);
router.post('/', protect, sendMessage);

module.exports = router;
