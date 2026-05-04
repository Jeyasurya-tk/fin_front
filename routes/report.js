const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getDailyReport, getFullReport } = require('../controllers/reportController');

router.get('/daily', protect, getDailyReport);
router.get('/full', protect, getFullReport);

module.exports = router;
