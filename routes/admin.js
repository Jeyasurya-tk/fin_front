const express = require('express');
const router = express.Router();
const { resetDatabase } = require('../controllers/adminController');
const { protect } = require('../middleware/auth');

router.delete('/reset-db', protect, resetDatabase);

module.exports = router;
