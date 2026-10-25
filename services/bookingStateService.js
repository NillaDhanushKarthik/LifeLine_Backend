const Booking = require('../models/Booking');
const Driver = require('../models/Driver');
const { AppError } = require('../utils/apiResponse');
const { emitToUser } = require('../socket/emitter');

const ACTIVE_STATUSES = ['SEARCHING', 'DRIVER_ASSIGNED', 'ACCEPTED', 'DRIVER_ARRIVING', 'ARRIVED', 'TRIP_STARTED'];
const TRACKING_STATUSES = ['ACCEPTED', 'DRIVER_ARRIVING', 'ARRIVED', 'TRIP_STARTED'];

/** Allowed status transitions. */
const TRANSITIONS = {
  SEARCHING: ['ACCEPTED', 'DRIVER_ASSIGNED', 'CANCELLED'],
  DRIVER_ASSIGNED: ['ACCEPTED', 'SEARCHING', 'CANCELLED'],
  ACCEPTED: ['DRIVER_ARRIVING', 'CANCELLED'],
  DRIVER_ARRIVING: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['TRIP_STARTED', 'CANCELLED'],
  TRIP_STARTED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const TIMESTAMP_FIELD = {
  ACCEPTED: 'acceptedAt', ARRIVED: 'arrivedAt', TRIP_STARTED: 'startedAt',
  COMPLETED: 'completedAt', CANCELLED: 'cancelledAt',
};

/** Loads a booking with driver + driver's user populated. */
const loadBooking = (id) =>
  Booking.findById(id).populate({ path: 'driverId', populate: { path: 'userId', select: 'fullName phone' } });

/** Plain object sent to clients. Expects a booking from loadBooking(). */
const toClient = (b) => {
  const isSearching = ['SEARCHING', 'Searching'].includes(b.status);
  const driverObj = (!isSearching && b.driverId) ? (
    b.driverId.toClient ? b.driverId.toClient() : (b.driverId.userId ? {
      id: b.driverId.id || b.driverId._id,
      name: b.driverId.userId.fullName,
      fullName: b.driverId.userId.fullName,
      phone: b.driverId.userId.phone,
      vehicleNumber: b.driverId.ambulanceNumber,
      ambulanceNumber: b.driverId.ambulanceNumber,
      ambulanceType: b.driverId.ambulanceType,
      location: b.driverId.location,
    } : null)
  ) : null;

  return {
    id: b.id,
    _id: b.id,
    status: b.status,
    ambulanceType: b.ambulanceType,
    pickupLocation: b.pickupLocation,
    pickup: b.pickupLocation ? { coordinates: [b.pickupLocation.longitude, b.pickupLocation.latitude] } : null,
    destination: b.destination,
    hospital: b.destination ? { name: b.destination.address || 'Emergency Hospital', location: { coordinates: [b.destination.longitude, b.destination.latitude] }, emergencyPhone: b.destination.emergencyPhone || '108', isEmergencyAttending: true, emergencyStatus: '24/7 Casualty & Trauma Bay Active' } : null,
    etaMinutes: b.etaMinutes,
    distanceKm: b.distanceKm,
    driver: driverObj,
    cancelReason: b.cancelReason,
    createdAt: b.createdAt,
    acceptedAt: b.acceptedAt,
    arrivedAt: b.arrivedAt,
    startedAt: b.startedAt,
    completedAt: b.completedAt,
  };
};

/** Pushes the current booking state to the patient (and the driver, if assigned). */
const broadcast = async (bookingId) => {
  const booking = await loadBooking(bookingId);
  if (!booking) return;
  const payload = toClient(booking);
  emitToUser(booking.customerId, 'booking:status', payload);
  emitToUser(booking.customerId, 'booking:update', { booking: payload, driver: payload.driver, hospital: payload.hospital });
  if (booking.driverId && booking.driverId.userId) {
    emitToUser(booking.driverId.userId._id, 'booking:status', payload);
    emitToUser(booking.driverId.userId._id, 'booking:update', { booking: payload, driver: payload.driver, hospital: payload.hospital });
  }
};

/** Validates and applies a status change, stamping the matching timestamp. */
const transition = async (booking, next, extra = {}) => {
  if (!TRANSITIONS[booking.status] || !TRANSITIONS[booking.status].includes(next)) {
    throw new AppError(`Cannot change booking from ${booking.status} to ${next}`, 409);
  }
  booking.status = next;
  if (TIMESTAMP_FIELD[next]) booking[TIMESTAMP_FIELD[next]] = new Date();
  Object.assign(booking, extra);
  await booking.save();
  await broadcast(booking.id);
  return booking;
};

/** Tells a driver (by Driver doc id) that a booking was cancelled/withdrawn. */
const notifyDriverCancelled = async (driverDocId, bookingId, reason) => {
  const driver = await Driver.findById(driverDocId);
  if (driver) emitToUser(driver.userId, 'booking:cancelled', { bookingId, reason });
};

module.exports = {
  ACTIVE_STATUSES, TRACKING_STATUSES, TRANSITIONS,
  loadBooking, toClient, broadcast, transition, notifyDriverCancelled,
};
