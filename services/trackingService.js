const Driver = require('../models/Driver');
const Booking = require('../models/Booking');
const { isValidCoord, haversineKm, estimateEtaMinutes } = require('../utils/geo');
const { getRoute } = require('./mapsService');
const { emitToUser } = require('../socket/emitter');
const { TRACKING_STATUSES } = require('./bookingStateService');

const ROUTE_REFRESH_MS = 30_000;   // call Directions at most this often per booking
const DB_WRITE_MS = 3_000;         // persist driver position at most this often
const lastRoute = new Map();       // bookingId -> timestamp
const lastWrite = new Map();       // driver userId -> timestamp

/**
 * Handles one GPS update from a driver (socket or HTTP):
 *  1. saves the position, 2. forwards it to the patient, 3. refreshes ETA.
 */
exports.handleLocation = async (driverUserId, payload = {}) => {
  const latitude = payload.latitude != null ? payload.latitude : payload.lat;
  const longitude = payload.longitude != null ? payload.longitude : payload.lng;
  const heading = payload.heading || 0;
  if (!isValidCoord(latitude, longitude)) return null;
  const point = { latitude, longitude };

  const now = Date.now();
  const shouldWrite = now - (lastWrite.get(String(driverUserId)) || 0) >= DB_WRITE_MS;
  const driver = shouldWrite
    ? await Driver.findOneAndUpdate(
        { userId: driverUserId },
        { location: { type: 'Point', coordinates: [longitude, latitude] }, lastLocationAt: new Date() },
        { new: true }
      )
    : await Driver.findOne({ userId: driverUserId });
  if (!driver) return null;
  if (shouldWrite) lastWrite.set(String(driverUserId), now);

  const booking = await Booking.findOne({ driverId: driver._id, status: { $in: TRACKING_STATUSES } });
  if (!booking) {
    if (driver.isAvailable) {
      try {
        const { broadcastAll } = require('../socket/emitter');
        broadcastAll('nearby:ambulance:update', {
          id: driver.id,
          ambulanceNumber: driver.ambulanceNumber,
          ambulanceType: driver.ambulanceType,
          latitude,
          longitude,
          heading,
        });
      } catch (err) {}
    }
    return { driver, booking: null };
  }

  emitToUser(booking.customerId, 'driver:location', { bookingId: booking.id, latitude, longitude, heading });
  emitToUser(booking.customerId, 'ambulance:location', {
    location: { type: 'Point', coordinates: [longitude, latitude] },
    heading,
    etaMinutes: booking.etaMinutes,
    distanceKm: booking.distanceKm,
  });

  // Target is the patient until the trip starts, then the destination.
  const target = booking.status === 'TRIP_STARTED' ? booking.destination : booking.pickupLocation;
  let eta;
  if (now - (lastRoute.get(booking.id) || 0) >= ROUTE_REFRESH_MS) {
    lastRoute.set(booking.id, now);
    eta = await getRoute(point, target);
  } else {
    const km = haversineKm(point, target);
    eta = { distanceKm: +km.toFixed(2), etaMinutes: estimateEtaMinutes(km), polyline: null };
  }
  booking.etaMinutes = eta.etaMinutes;
  booking.distanceKm = eta.distanceKm;
  await booking.save();

  emitToUser(booking.customerId, 'booking:eta', { bookingId: booking.id, ...eta });
  return { driver, booking };
};

exports.clearBooking = (bookingId) => lastRoute.delete(String(bookingId));
