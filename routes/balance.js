const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { addBalance, getBalanceHistory } = require('../controllers/balanceController');

router.post('/add', protect, addBalance);
router.get('/', protect, getBalanceHistory);

module.exports = router;
