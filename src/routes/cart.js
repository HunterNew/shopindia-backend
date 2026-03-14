const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/cartController');
const { auth } = require('../middleware/auth');

router.use(auth);
router.get ('/', ctrl.get);
router.post('/', ctrl.add);
router.put ('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.delete('/', ctrl.clear);

module.exports = router;
