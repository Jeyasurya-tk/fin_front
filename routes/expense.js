const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { addExpense, getExpenses } = require('../controllers/expenseController');

router.post('/', protect, addExpense);
router.get('/', protect, getExpenses);

module.exports = router;
