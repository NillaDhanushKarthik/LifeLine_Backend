const router = require('express').Router();
const ctrl = require('../controllers/bookingController');
const { protect } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

router.use(protect);

// Support both /api/book and /api/bookings
router.post('/book', requireRole('patient'), ctrl.book);
router.post('/bookings', requireRole('patient'), ctrl.book);

router.get('/ambulances/nearby', ctrl.getNearbyAmbulances);
router.get('/hospitals/nearby', ctrl.getNearbyHospitals);
router.get('/hospitals', ctrl.getNearbyHospitals);
router.get('/bookings/active', ctrl.getActive);
router.get('/bookings/mine', ctrl.history);

router.get('/booking/:id', ctrl.getBooking);
router.get('/bookings/:id', ctrl.getBooking);

router.post('/booking/:id/cancel', requireRole('patient'), ctrl.cancel);
router.post('/bookings/:id/cancel', requireRole('patient'), ctrl.cancel);

router.post('/bookings/:id/report', ctrl.report);

router.get('/history', ctrl.history);

module.exports = router;
