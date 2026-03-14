const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/authController');
const { auth } = require('../middleware/auth');

// Public routes
router.post('/register',        ctrl.register);
router.post('/login',           ctrl.login);

// Forgot password flow (no auth needed)
router.post('/forgot-password', ctrl.forgotPassword);
router.post('/verify-otp',      ctrl.verifyOTP);
router.post('/reset-password',  ctrl.resetPassword);

// Protected routes
router.get ('/me',              auth, ctrl.getMe);
router.put ('/profile',         auth, ctrl.updateProfile);
router.put ('/change-password', auth, ctrl.changePassword);

module.exports = router;