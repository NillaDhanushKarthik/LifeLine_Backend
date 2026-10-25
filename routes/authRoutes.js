const router = require('express').Router();
const { register, login, me, sendOtp, verifyOtp, updateMe } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { requireFields } = require('../middleware/validate');

router.post('/send-otp', requireFields('phone'), sendOtp);
router.post('/verify-otp', requireFields('phone', 'otp'), verifyOtp);
router.post('/register', requireFields('fullName', 'phone', 'password'), register);
router.post('/login', requireFields('phone', 'password'), login);
router.post('/driver/login', requireFields('phone', 'password'), login);
router.post('/driver/register', register);
router.get('/me', protect, me);
router.put('/me', protect, updateMe);

module.exports = router;
