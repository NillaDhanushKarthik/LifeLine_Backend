const router = require('express').Router();
const ctrl = require('../controllers/driverController');
const { protect } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

router.use(protect, requireRole('driver'));

// Online toggle
router.patch('/online', ctrl.setOnline);
router.post('/status', ctrl.setOnline);

// Requests
router.get('/requests', ctrl.requests);

// Accept / Reject
router.post('/bookings/:id/accept', ctrl.accept);
router.post('/accept', ctrl.accept);

router.post('/bookings/:id/reject', ctrl.reject);
router.post('/reject', ctrl.reject);

// Status progress
router.patch('/bookings/:id/status', ctrl.updateStatus);
router.post('/progress', ctrl.updateStatus);
router.post('/complete', ctrl.complete);

// Hospitals
router.get('/bookings/:id/hospitals', ctrl.getHospitals);
router.post('/bookings/:id/hospital', ctrl.chooseHospital);

// Location update fallback
router.post('/location/update', ctrl.updateLocation);

module.exports = router;
