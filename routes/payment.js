const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
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
} = require('../controllers/paymentController');

// ── Manager: payment request lifecycle ────────────────────────────────────────
router.post('/request',                          protect, createPaymentRequest);
router.post('/request/:requestId/cash',          protect, markCashPayment);
router.patch('/verify',                          protect, verifyPayment);

// ── Player: self-mark payment done ────────────────────────────────────────────
router.post('/mark-done',                        protect, playerMarkDone);

// ── Query ─────────────────────────────────────────────────────────────────────
router.get('/requests',                          protect, getPaymentRequests);
router.get('/requests/my',                       protect, getMyRequests);
router.get('/ledger',                            protect, getAllLedgers);
router.get('/ledger/me',                         protect, getMyLedger);
router.get('/summary',                           protect, getPaymentSummary);
router.get('/',                                  protect, getPayments);

// ── Legacy: direct player submission (no request session) ─────────────────────
router.post('/',                                 protect, addPayment);

module.exports = router;
