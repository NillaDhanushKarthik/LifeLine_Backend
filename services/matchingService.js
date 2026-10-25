const Booking = require('../models/Booking');
const Driver = require('../models/Driver');
const { haversineKm } = require('../utils/geo');
const { emitToUser } = require('../socket/emitter');
const state = require('./bookingStateService');

const REQUEST_TIMEOUT_MS = 30_000; // 30s for drivers to respond
const RETRY_DELAY_MS = 10_000;     // wait before searching again if nobody is free
const MAX_SEARCH_RETRIES = 5;
const SEARCH_RADIUS_M = 15_000;

// bookingId -> Timeout
const timers = new Map();
// bookingId -> Array<{ driverDocId: string, userId: string }>
const candidateDrivers = new Map();

const clearTimer = (bookingId) => {
  const idStr = String(bookingId);
  const t = timers.get(idStr);
  if (t) clearTimeout(t);
  timers.delete(idStr);
  try {
    const simulation = require('./simulationService');
    simulation.cancelSimulation(bookingId);
  } catch (err) {}
};

/** Finds all available online drivers who haven't rejected this booking */
const findAvailableDrivers = async (booking) => {
  const busy = await Booking.distinct('driverId', {
    status: { $in: ['ACCEPTED', 'DRIVER_ARRIVING', 'ARRIVED', 'TRIP_STARTED'] },
  });
  const excluded = [...busy, ...(booking.rejectedBy || [])];

  let drivers = [];
  try {
    drivers = await Driver.find({
      isAvailable: true,
      _id: { $nin: excluded },
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [booking.pickupLocation.longitude, booking.pickupLocation.latitude] },
          $maxDistance: SEARCH_RADIUS_M,
        },
      },
    }).populate('userId', 'fullName phone');
  } catch (err) {
    console.error('Geo search error in matchingService:', err.message);
  }

  if (!drivers || drivers.length === 0) {
    // Real driver fallback: match any online available driver
    drivers = await Driver.find({
      isAvailable: true,
      _id: { $nin: excluded },
    }).populate('userId', 'fullName phone');
  }

  return drivers || [];
};

/** Broadcasts emergency offer to ALL nearest online drivers simultaneously */
const dispatch = async (bookingId, attempt = 0) => {
  clearTimer(bookingId);
  const booking = await Booking.findById(bookingId);
  if (!booking || booking.status !== 'SEARCHING') return;

  const drivers = await findAvailableDrivers(booking);

  if (drivers.length === 0) {
    if (attempt >= MAX_SEARCH_RETRIES) {
      await state.transition(booking, 'CANCELLED', { cancelReason: 'NO_DRIVERS_AVAILABLE' });
      return;
    }
    timers.set(
      String(bookingId),
      setTimeout(() => dispatch(bookingId, attempt + 1).catch(console.error), RETRY_DELAY_MS)
    );
    return;
  }

  // Record candidate drivers for this booking
  candidateDrivers.set(
    String(bookingId),
    drivers.map((d) => ({
      driverDocId: String(d._id),
      userId: String(d.userId?._id || d.userId),
    }))
  );

  // Broadcast emergency offer to EVERY nearest online driver simultaneously
  for (const driver of drivers) {
    const targetUserId = driver.userId?._id || driver.userId;
    if (!targetUserId) continue;

    const coords = driver.location?.coordinates;
    const distanceToPickupKm =
      coords && coords.length === 2 && (coords[0] !== 0 || coords[1] !== 0)
        ? haversineKm({ latitude: coords[1], longitude: coords[0] }, booking.pickupLocation)
        : 2.5;

    const offerPayload = {
      bookingId: booking.id,
      id: booking.id,
      pickup: { coordinates: [booking.pickupLocation.longitude, booking.pickupLocation.latitude] },
      pickupLocation: booking.pickupLocation,
      destination: booking.destination,
      ambulanceType: booking.ambulanceType,
      distanceKm: +distanceToPickupKm.toFixed(2),
      etaMinutes: Math.max(1, Math.round(distanceToPickupKm * 2)),
      expiresInMs: REQUEST_TIMEOUT_MS,
      expiresInSeconds: REQUEST_TIMEOUT_MS / 1000,
    };

    emitToUser(targetUserId, 'booking:offer', offerPayload);
    emitToUser(targetUserId, 'booking:request', offerPayload);
  }

  // Note: booking.status remains SEARCHING until a driver accepts!
  // Set timeout to expire this batch if nobody accepts
  timers.set(
    String(bookingId),
    setTimeout(async () => {
      const b = await Booking.findById(bookingId);
      if (b && b.status === 'SEARCHING') {
        const candidates = candidateDrivers.get(String(bookingId)) || [];
        for (const c of candidates) {
          if (c.userId) emitToUser(c.userId, 'booking:expired', { bookingId });
        }
        candidateDrivers.delete(String(bookingId));
        dispatch(bookingId, attempt + 1).catch(console.error);
      }
    }, REQUEST_TIMEOUT_MS)
  );
};

/** When a driver accepts, notify all other candidate drivers that the offer was taken */
const notifyOthersTaken = (bookingId, acceptedDriverDocId) => {
  const idStr = String(bookingId);
  const acceptedStr = String(acceptedDriverDocId);
  const candidates = candidateDrivers.get(idStr) || [];
  for (const c of candidates) {
    if (c.driverDocId !== acceptedStr && c.userId) {
      emitToUser(c.userId, 'booking:taken', { bookingId, message: 'Request Already Accepted' });
    }
  }
  candidateDrivers.delete(idStr);
};

/** When a patient cancels while searching, notify all candidate drivers */
const notifyCancelled = (bookingId) => {
  const idStr = String(bookingId);
  const candidates = candidateDrivers.get(idStr) || [];
  for (const c of candidates) {
    if (c.userId) {
      emitToUser(c.userId, 'booking:cancelled', { bookingId, reason: 'CANCELLED_BY_PATIENT' });
    }
  }
  candidateDrivers.delete(idStr);
};

/** Takes the booking back from a driver (reject) */
const releaseDriver = async (bookingId, driverDocId, reason) => {
  const b = await Booking.findById(bookingId);
  if (!b) return false;

  await Booking.findByIdAndUpdate(bookingId, { $addToSet: { rejectedBy: driverDocId } });

  const idStr = String(bookingId);
  const remaining = (candidateDrivers.get(idStr) || []).filter(
    (c) => c.driverDocId !== String(driverDocId)
  );
  candidateDrivers.set(idStr, remaining);

  if (remaining.length === 0 && b.status === 'SEARCHING') {
    clearTimer(bookingId);
    dispatch(bookingId, 0).catch(console.error);
  }
  return true;
};

module.exports = {
  dispatch,
  releaseDriver,
  clearTimer,
  notifyOthersTaken,
  notifyCancelled,
};
