const Booking = require('../models/Booking');
const Driver = require('../models/Driver');
const { AppError, asyncHandler, ok } = require('../utils/apiResponse');
const state = require('../services/bookingStateService');
const matching = require('../services/matchingService');
const tracking = require('../services/trackingService');
const { getRoute } = require('../services/mapsService');
const hospitalService = require('../services/hospitalService');

const getDriver = async (user) => {
  const driver = await Driver.findOne({ userId: user._id });
  if (!driver) throw new AppError('Driver profile not found', 404);
  return driver;
};

const getOwnBooking = async (driver, bookingId) => {
  const booking = await Booking.findOne({ _id: bookingId, driverId: driver._id });
  if (!booking) throw new AppError('Booking not found', 404);
  return booking;
};

/** GET /api/driver/requests */
exports.requests = asyncHandler(async (req, res) => {
  const driver = await getDriver(req.user);
  const bookings = await Booking.find({
    status: { $in: ['SEARCHING', 'DRIVER_ASSIGNED'] },
    rejectedBy: { $ne: driver._id },
    ...(driver.isAvailable ? {} : { driverId: driver._id }),
  });
  ok(res, {
    requests: bookings.map((b) => ({
      bookingId: b.id,
      pickupLocation: b.pickupLocation,
      destination: b.destination,
      ambulanceType: b.ambulanceType,
    }))
  });
});

/** PATCH /api/driver/online or POST /api/driver/status */
exports.setOnline = asyncHandler(async (req, res) => {
  const driver = await getDriver(req.user);
  const isOnline = req.body.online !== undefined ? !!req.body.online : (req.body.isAvailable !== undefined ? !!req.body.isAvailable : true);

  if (!isOnline) {
    const busy = await Booking.exists({
      driverId: driver._id,
      status: { $in: ['DRIVER_ASSIGNED', 'ACCEPTED', 'DRIVER_ARRIVING', 'ARRIVED', 'TRIP_STARTED'] },
    });
    if (busy) throw new AppError('Finish your current request before going offline', 409);
  }

  driver.isAvailable = isOnline;
  await driver.save();

  try {
    const { broadcastAll } = require('../socket/emitter');
    broadcastAll('nearby:ambulance:status', {
      id: driver.id,
      isAvailable: driver.isAvailable,
      ambulanceNumber: driver.ambulanceNumber,
      ambulanceType: driver.ambulanceType,
      latitude: driver.location?.coordinates?.[1] || 0,
      longitude: driver.location?.coordinates?.[0] || 0,
    });
  } catch (err) {}

  ok(res, { success: true, online: driver.isAvailable, isAvailable: driver.isAvailable, driver: driver.toClient() });
});

/** POST /api/driver/bookings/:id/accept or POST /api/driver/accept */
exports.accept = asyncHandler(async (req, res) => {
  const bookingId = req.params.id || req.body.bookingId;
  const driver = await getDriver(req.user);

  // Atomic claim: only succeeds if booking is still in SEARCHING or DRIVER_ASSIGNED state
  const booking = await Booking.findOneAndUpdate(
    { _id: bookingId, status: { $in: ['SEARCHING', 'DRIVER_ASSIGNED'] } },
    { status: 'ACCEPTED', driverId: driver._id, acceptedAt: new Date() },
    { new: true }
  );
  if (!booking) {
    throw new AppError('This emergency request was already accepted by another ambulance', 409);
  }

  matching.clearTimer(booking.id);
  matching.notifyOthersTaken(booking.id, driver._id);

  driver.isAvailable = false;
  await driver.save();

  try {
    const origin = { latitude: driver.location.coordinates[1], longitude: driver.location.coordinates[0] };
    const route = await getRoute(origin, booking.pickupLocation);
    booking.etaMinutes = route.etaMinutes;
    booking.distanceKm = route.distanceKm;
    await booking.save();
  } catch (err) {
    console.error('Route calculation error on accept:', err.message);
  }

  await state.broadcast(booking.id);
  const clientBooking = state.toClient(await state.loadBooking(booking.id));
  res.json({ success: true, ...clientBooking, booking: clientBooking });
});

/** POST /api/driver/bookings/:id/reject or POST /api/driver/reject */
exports.reject = asyncHandler(async (req, res) => {
  const bookingId = req.params.id || req.body.bookingId;
  const driver = await getDriver(req.user);
  const released = await matching.releaseDriver(bookingId, driver._id, 'REJECTED');
  if (!released) throw new AppError('Request is no longer available', 409);
  ok(res, { message: 'Request rejected' });
});

/** PATCH /api/driver/bookings/:id/status or POST /api/driver/progress */
exports.updateStatus = asyncHandler(async (req, res) => {
  const bookingId = req.params.id || req.body.bookingId;
  const rawStatus = req.body.status;
  const statusMap = {
    'Driver Arriving': 'DRIVER_ARRIVING',
    'DRIVER_ARRIVING': 'DRIVER_ARRIVING',
    'Arrived': 'ARRIVED',
    'ARRIVED': 'ARRIVED',
    'Patient Picked': 'ARRIVED',
    'Trip Started': 'TRIP_STARTED',
    'TRIP_STARTED': 'TRIP_STARTED',
    'Completed': 'COMPLETED',
    'COMPLETED': 'COMPLETED',
  };
  const status = statusMap[rawStatus] || rawStatus;
  const driver = await getDriver(req.user);
  const booking = await getOwnBooking(driver, bookingId);

  if (status === 'COMPLETED') {
    await state.transition(booking, 'COMPLETED');
    driver.isAvailable = true;
    driver.totalTrips += 1;
    await driver.save();
    tracking.clearBooking(booking.id);
  } else {
    await state.transition(booking, status);
  }

  const clientBooking = state.toClient(await state.loadBooking(booking.id));
  res.json({ success: true, status: clientBooking.status, ...clientBooking, booking: clientBooking });
});

/** POST /api/driver/complete */
exports.complete = asyncHandler(async (req, res) => {
  const bookingId = req.params.id || req.body.bookingId;
  const driver = await getDriver(req.user);
  const booking = await getOwnBooking(driver, bookingId);
  await state.transition(booking, 'COMPLETED');

  driver.isAvailable = true;
  driver.totalTrips += 1;
  await driver.save();
  tracking.clearBooking(booking.id);

  const clientBooking = state.toClient(await state.loadBooking(booking.id));
  res.json({ success: true, ...clientBooking, booking: clientBooking });
});

/** GET /api/driver/bookings/:id/hospitals */
exports.getHospitals = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  const location = booking?.pickupLocation || { latitude: 17.385, longitude: 78.4867 };
  const hospitals = await hospitalService.findNearbyHospitals(location);
  res.json(hospitals);
});

/** POST /api/driver/bookings/:id/hospital */
exports.chooseHospital = asyncHandler(async (req, res) => {
  const bookingId = req.params.id;
  const { hospitalId, name, latitude, longitude, address, coordinates } = req.body;
  const driver = await getDriver(req.user);
  const booking = await getOwnBooking(driver, bookingId);

  let selected = null;

  // 1. Direct explicit coordinates in request body
  if (name && ((latitude != null && longitude != null) || (Array.isArray(coordinates) && coordinates.length === 2))) {
    const lat = latitude != null ? Number(latitude) : Number(coordinates[1]);
    const lng = longitude != null ? Number(longitude) : Number(coordinates[0]);
    selected = {
      name,
      address: address || name,
      latitude: lat,
      longitude: lng,
      coordinates: [lng, lat],
    };
  }

  // 2. Lookup in real nearby hospitals from the map
  if (!selected) {
    const nearby = await hospitalService.findNearbyHospitals(booking.pickupLocation);
    if (hospitalId) {
      selected = nearby.find((h) => h.id === hospitalId || h._id === hospitalId);
    }
    // Fallback to nearest hospital if ID not matched
    if (!selected && nearby.length > 0) {
      selected = nearby[0];
    }
  }

  if (!selected) {
    throw new AppError('Could not find or select a hospital for this location', 400);
  }

  const destLat = selected.latitude != null ? selected.latitude : selected.coordinates[1];
  const destLng = selected.longitude != null ? selected.longitude : selected.coordinates[0];

  booking.destination = {
    address: selected.name,
    latitude: destLat,
    longitude: destLng,
  };

  // Recalculate ETA and route to destination hospital
  try {
    const currentLoc = {
      latitude: driver.location?.coordinates?.[1] || booking.pickupLocation.latitude,
      longitude: driver.location?.coordinates?.[0] || booking.pickupLocation.longitude,
    };
    const route = await getRoute(currentLoc, { latitude: destLat, longitude: destLng });
    if (route) {
      booking.etaMinutes = route.etaMinutes;
      booking.distanceKm = route.distanceKm;
    }
  } catch (err) {
    console.warn('Hospital route calculation failed:', err.message);
  }

  await booking.save();
  await state.broadcast(booking.id);

  const clientBooking = state.toClient(await state.loadBooking(booking.id));
  res.json({
    success: true,
    booking: clientBooking,
    hospital: {
      name: selected.name,
      address: selected.address || selected.name,
      location: { coordinates: [destLng, destLat] },
      distanceKm: clientBooking.distanceKm,
      etaMinutes: clientBooking.etaMinutes,
    },
  });
});

/** POST /api/driver/location/update */
exports.updateLocation = asyncHandler(async (req, res) => {
  const result = await tracking.handleLocation(req.user._id, req.body);
  if (!result) throw new AppError('Invalid location or driver not found', 400);
  ok(res, { updated: true });
});
