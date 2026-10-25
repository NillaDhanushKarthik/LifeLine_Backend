const tracking = require('../services/trackingService');

/** Driver → server: continuous GPS stream, e.g. every 2–3 seconds. */
module.exports = function registerDriverHandlers(socket) {
  socket.on('driver:location', async (payload, ack) => {
    try {
      await tracking.handleLocation(socket.user._id, payload || {});
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      console.error('driver:location failed:', err.message);
      if (typeof ack === 'function') ack({ ok: false });
    }
  });
};
