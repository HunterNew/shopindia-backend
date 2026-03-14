const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/orderController');
const { auth } = require('../middleware/auth');

// PhonePe callback — no auth (called by PhonePe servers)
router.post('/phonepe-callback', ctrl.phonePeCallback);

router.use(auth);
router.post('/initiate-phonepe', ctrl.initiatePhonePe);
router.post('/', ctrl.place);
router.get ('/', ctrl.myOrders);
router.get ('/:id', ctrl.getOne);

module.exports = router;
