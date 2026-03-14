const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/productController');

router.get('/', ctrl.list);
router.get('/:slug', ctrl.get);

module.exports = router;
