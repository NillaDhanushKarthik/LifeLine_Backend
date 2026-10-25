const axios = require('axios');
const { googleMapsKey } = require('../config/env');
const { haversineKm, estimateEtaMinutes } = require('../utils/geo');

/**
 * Route distance + ETA between two {latitude, longitude} points.
 * Uses Google Directions when a key is configured, otherwise (or on failure)
 * falls back to a straight-line estimate so the app still works offline/in demos.
 */
exports.getRoute = async (origin, dest) => {
  if (googleMapsKey) {
    try {
      const { data } = await axios.get('https://maps.googleapis.com/maps/api/directions/json', {
        params: {
          origin: `${origin.latitude},${origin.longitude}`,
          destination: `${dest.latitude},${dest.longitude}`,
          mode: 'driving',
          departure_time: 'now',
          key: googleMapsKey,
        },
        timeout: 5000,
      });
      const leg = data.routes?.[0]?.legs?.[0];
      if (leg) {
        return {
          distanceKm: +(leg.distance.value / 1000).toFixed(2),
          etaMinutes: Math.max(1, Math.round((leg.duration_in_traffic || leg.duration).value / 60)),
          polyline: data.routes[0].overview_polyline.points,
        };
      }
    } catch (err) {
      console.warn('Directions API failed, using fallback:', err.message);
    }
  }
  const km = haversineKm(origin, dest);
  return { distanceKm: +km.toFixed(2), etaMinutes: estimateEtaMinutes(km), polyline: null };
};
