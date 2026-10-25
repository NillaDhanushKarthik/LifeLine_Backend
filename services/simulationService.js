const Booking = require('../models/Booking');
const Driver = require('../models/Driver');
const state = require('./bookingStateService');
const tracking = require('./trackingService');
const matching = require('./matchingService');
const { getRoute } = require('./mapsService');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Active simulation cancel tokens: bookingId -> boolean
const activeSimulations = new Map();

/**
 * Simulates driver acceptance, route navigation to pickup, arrival,
 * and completion to destination.
 */
async function startSimulation(bookingId) {
  const simKey = String(bookingId);
  activeSimulations.set(simKey, true);

  const shouldContinue = async (expectedStatus) => {
    if (!activeSimulations.get(simKey)) return false;
    const booking = await Booking.findById(bookingId);
    if (!booking) return false;
    if (['CANCELLED', 'COMPLETED'].includes(booking.status)) return false;
    if (expectedStatus && booking.status !== expectedStatus) return false;
    return booking;
  };

  try {
    // 1. Wait 3 seconds to simulate driver seeing the incoming request
    await delay(3000);
    let booking = await shouldContinue('DRIVER_ASSIGNED');
    if (!booking) return;

    const driver = await Driver.findById(booking.driverId).populate('userId');
    if (!driver) return;

    // Clear timeout timer so matchingService doesn't release
    matching.clearTimer(booking.id);

    // 2. Driver Accepts
    booking.status = 'ACCEPTED';
    booking.acceptedAt = new Date();
    driver.isAvailable = false;
    await driver.save();

    const origin = { latitude: driver.location.coordinates[1], longitude: driver.location.coordinates[0] };
    const route = await getRoute(origin, booking.pickupLocation);
    booking.etaMinutes = route.etaMinutes;
    booking.distanceKm = route.distanceKm;
    await booking.save();
    await state.broadcast(booking.id);
    console.log(`[SIMULATOR] Driver ${driver.ambulanceNumber} accepted booking ${booking.id}`);

    // 3. Driver starts moving toward pickup
    await delay(2500);
    booking = await shouldContinue('ACCEPTED');
    if (!booking) return;

    await state.transition(booking, 'DRIVER_ARRIVING');
    console.log(`[SIMULATOR] Driver is arriving at pickup...`);

    // Interpolate from driver start location to pickup location in 10 steps
    const startLat = origin.latitude;
    const startLng = origin.longitude;
    const endLat = booking.pickupLocation.latitude;
    const endLng = booking.pickupLocation.longitude;
    const stepsToPickup = 10;

    for (let i = 1; i <= stepsToPickup; i++) {
      await delay(2500);
      booking = await shouldContinue('DRIVER_ARRIVING');
      if (!booking) return;

      const progress = i / stepsToPickup;
      const currentLat = startLat + (endLat - startLat) * progress;
      const currentLng = startLng + (endLng - startLng) * progress;
      const heading = Math.round(Math.atan2(endLng - startLng, endLat - startLat) * (180 / Math.PI));

      await tracking.handleLocation(driver.userId._id, {
        latitude: +currentLat.toFixed(6),
        longitude: +currentLng.toFixed(6),
        heading: (heading + 360) % 360,
      });
    }

    // 4. Arrived at pickup
    booking = await shouldContinue('DRIVER_ARRIVING');
    if (!booking) return;

    await state.transition(booking, 'ARRIVED');
    console.log(`[SIMULATOR] Driver arrived at pickup location.`);

    // 5. Patient enters ambulance, Trip Starts
    await delay(4000);
    booking = await shouldContinue('ARRIVED');
    if (!booking) return;

    await state.transition(booking, 'TRIP_STARTED');
    console.log(`[SIMULATOR] Trip started toward destination.`);

    // Interpolate from pickup to destination in 12 steps
    const destLat = booking.destination.latitude;
    const destLng = booking.destination.longitude;
    const stepsToDest = 12;

    for (let i = 1; i <= stepsToDest; i++) {
      await delay(2500);
      booking = await shouldContinue('TRIP_STARTED');
      if (!booking) return;

      const progress = i / stepsToDest;
      const currentLat = endLat + (destLat - endLat) * progress;
      const currentLng = endLng + (destLng - endLng) * progress;
      const heading = Math.round(Math.atan2(destLng - endLng, destLat - endLat) * (180 / Math.PI));

      await tracking.handleLocation(driver.userId._id, {
        latitude: +currentLat.toFixed(6),
        longitude: +currentLng.toFixed(6),
        heading: (heading + 360) % 360,
      });
    }

    // 6. Complete trip
    booking = await shouldContinue('TRIP_STARTED');
    if (!booking) return;

    await state.transition(booking, 'COMPLETED');
    driver.isAvailable = true;
    driver.totalTrips += 1;
    await driver.save();
    tracking.clearBooking(booking.id);
    console.log(`[SIMULATOR] Trip completed successfully! Driver is available again.`);
  } catch (err) {
    console.error('[SIMULATOR] Simulation error:', err.message);
  } finally {
    activeSimulations.delete(simKey);
  }
}

function cancelSimulation(bookingId) {
  activeSimulations.set(String(bookingId), false);
}

module.exports = { startSimulation, cancelSimulation };
