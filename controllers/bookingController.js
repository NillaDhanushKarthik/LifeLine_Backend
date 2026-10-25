const Booking = require('../models/Booking');
const Driver = require('../models/Driver');
const { AppError, asyncHandler, ok } = require('../utils/apiResponse');
const { isValidCoord } = require('../utils/geo');
const state = require('../services/bookingStateService');
const matching = require('../services/matchingService');
const hospitalService = require('../services/hospitalService');

const assertPlace = (p, name) => {
  if (!p || !isValidCoord(p.latitude, p.longitude)) {
    throw new AppError(`${name} must include valid latitude and longitude`, 400);
  }
  return { address: p.address || 'Location', latitude: p.latitude, longitude: p.longitude };
};

/** POST /api/book or /api/bookings */
exports.book = asyncHandler(async (req, res) => {
  let { pickupLocation, destination, ambulanceType = 'BASIC', lat, lng } = req.body;
  if (!pickupLocation && lat != null && lng != null) {
    pickupLocation = { latitude: Number(lat), longitude: Number(lng), address: 'Pickup Location' };
  }
  if (!destination && pickupLocation) {
    const nearestHospital = await hospitalService.findNearestHospital(pickupLocation);
    destination = {
      latitude: nearestHospital.latitude,
      longitude: nearestHospital.longitude,
      address: nearestHospital.name
    };
  }

  const pickup = assertPlace(pickupLocation, 'pickupLocation');
  const drop = assertPlace(destination, 'destination');

  const existing = await Booking.findOne({ customerId: req.user._id, status: { $in: state.ACTIVE_STATUSES } });
  if (existing) throw new AppError(`You already have an active booking (${existing.id})`, 409);

  const booking = await Booking.create({
    customerId: req.user._id, pickupLocation: pickup, destination: drop, ambulanceType,
  });

  // Dispatch offer to all nearest online drivers
  await matching.dispatch(booking.id);

  const clientBooking = state.toClient(await state.loadBooking(booking.id));
  res.status(201).json({ success: true, booking: clientBooking, ...clientBooking });
});

/** GET /api/bookings/active */
exports.getActive = asyncHandler(async (req, res) => {
  const existing = await Booking.findOne({ customerId: req.user._id, status: { $in: state.ACTIVE_STATUSES } });
  if (!existing) return res.json(null);
  const clientBooking = state.toClient(await state.loadBooking(existing.id));
  res.json({ success: true, booking: clientBooking, ...clientBooking });
});

/** GET /api/booking/:id or /api/bookings/:id */
exports.getBooking = asyncHandler(async (req, res) => {
  const booking = await state.loadBooking(req.params.id);
  if (!booking) throw new AppError('Booking not found', 404);

  const isOwner = booking.customerId.equals(req.user._id);
  const isDriver = booking.driverId && booking.driverId.userId && booking.driverId.userId._id.equals(req.user._id);
  if (!isOwner && !isDriver) throw new AppError('Booking not found', 404);

  const clientBooking = state.toClient(booking);
  res.json({ success: true, booking: clientBooking, ...clientBooking });
});

/** POST /api/booking/:id/cancel or /api/bookings/:id/cancel */
exports.cancel = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking || !booking.customerId.equals(req.user._id)) throw new AppError('Booking not found', 404);
  if (!['SEARCHING', 'DRIVER_ASSIGNED', 'ACCEPTED', 'DRIVER_ARRIVING'].includes(booking.status)) {
    throw new AppError('Booking can only be cancelled before arrival', 409);
  }
  const driverDocId = booking.driverId;
  matching.clearTimer(booking.id);
  matching.notifyCancelled(booking.id);
  await state.transition(booking, 'CANCELLED', { cancelReason: 'PATIENT' });
  if (driverDocId) {
    await state.notifyDriverCancelled(driverDocId, booking.id, 'PATIENT');
    await Driver.findByIdAndUpdate(driverDocId, { isAvailable: true });
  }

  const clientBooking = state.toClient(await state.loadBooking(booking.id));
  res.json({ success: true, booking: clientBooking, ...clientBooking });
});

/** POST /api/bookings/:id/report */
exports.report = asyncHandler(async (req, res) => {
  ok(res, { reported: true });
});

/** GET /api/history or /api/bookings/mine */
exports.history = asyncHandler(async (req, res) => {
  let filter = { customerId: req.user._id };
  if (req.user.role === 'driver') {
    const driver = await Driver.findOne({ userId: req.user._id });
    filter = { driverId: driver ? driver._id : null };
  }
  const bookings = await Booking.find({ ...filter, status: { $in: ['COMPLETED', 'CANCELLED'] } })
    .sort({ createdAt: -1 }).limit(50)
    .populate({ path: 'driverId', populate: { path: 'userId', select: 'fullName phone' } });
  const list = bookings.map(state.toClient);
  res.json({ success: true, bookings: list, data: list });
});

/** GET /api/ambulances/nearby */
exports.getNearbyAmbulances = asyncHandler(async (req, res) => {
  const lat = req.query.lat != null ? Number(req.query.lat) : null;
  const lng = req.query.lng != null ? Number(req.query.lng) : null;
  const radius = req.query.radius != null ? Number(req.query.radius) : 50000;

  let query = {
    isAvailable: true,
    'location.coordinates': { $ne: [0, 0] }
  };

  if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
    query.location = {
      $near: {
        $geometry: { type: 'Point', coordinates: [lng, lat] },
        $maxDistance: radius,
      },
    };
  }

  let drivers = [];
  try {
    drivers = await Driver.find(query).populate('userId', 'fullName phone').limit(20);
  } catch (err) {
    drivers = await Driver.find({ isAvailable: true, 'location.coordinates': { $ne: [0, 0] } }).populate('userId', 'fullName phone').limit(20);
  }

  const { haversineKm } = require('../utils/geo');
  const list = drivers.map(d => {
    const dLat = d.location?.coordinates?.[1] || 0;
    const dLng = d.location?.coordinates?.[0] || 0;
    let distKm = null;
    if (lat != null && lng != null && dLat !== 0 && dLng !== 0) {
      distKm = +haversineKm({ latitude: dLat, longitude: dLng }, { latitude: lat, longitude: lng }).toFixed(1);
    }
    return {
      id: d.id,
      _id: d.id,
      name: d.userId?.fullName || 'Lifeline Ambulance',
      phone: d.userId?.phone,
      ambulanceNumber: d.ambulanceNumber,
      vehicleNumber: d.ambulanceNumber,
      ambulanceType: d.ambulanceType || 'BASIC',
      latitude: dLat,
      longitude: dLng,
      distanceKm: distKm,
      isAvailable: d.isAvailable,
      rating: d.rating || 5,
    };
  });

  ok(res, { ambulances: list, count: list.length });
});

/** GET /api/hospitals/nearby or /api/hospitals */
exports.getNearbyHospitals = asyncHandler(async (req, res) => {
  const lat = req.query.lat != null ? Number(req.query.lat) : (req.query.latitude != null ? Number(req.query.latitude) : null);
  const lng = req.query.lng != null ? Number(req.query.lng) : (req.query.longitude != null ? Number(req.query.longitude) : null);
  const radius = req.query.radius ? Number(req.query.radius) : 15;

  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
    throw new AppError('lat and lng query parameters are required', 400);
  }

  const hospitals = await hospitalService.findNearbyHospitals({ latitude: lat, longitude: lng }, radius);
  ok(res, { count: hospitals.length, hospitals });
});

