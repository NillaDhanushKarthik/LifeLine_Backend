const R = 6371; // Earth radius, km
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance between two {latitude, longitude} points, in km. */
exports.haversineKm = (a, b) => {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Rough ETA assuming an average ambulance speed in city traffic. */
exports.estimateEtaMinutes = (km, avgKmh = 35) => Math.max(1, Math.round((km / avgKmh) * 60));

exports.isValidCoord = (lat, lng) =>
  typeof lat === 'number' && typeof lng === 'number' &&
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
