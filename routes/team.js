const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { protect } = require('../middleware/auth');
const { createTeam, joinTeam, approveRequest, getMyTeam, getMyTeams, switchTeam, promoteUser, uploadQR, removePlayer, updateAlias } = require('../controllers/teamController');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `qr_${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/create', protect, createTeam);
router.post('/join', protect, joinTeam);
router.post('/approve', protect, approveRequest);
router.get('/my', protect, getMyTeam);
router.get('/all', protect, getMyTeams);
router.patch('/switch', protect, switchTeam);
router.patch('/promote', protect, promoteUser);
router.post('/upload-qr', protect, upload.single('qr'), uploadQR);
router.post('/remove', protect, removePlayer);
router.post('/alias', protect, updateAlias);

module.exports = router;
