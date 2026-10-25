/** Holds the Socket.IO instance so services can emit without importing the server. */
let io = null;

exports.setIO = (instance) => { io = instance; };
exports.emitToUser = (userId, event, payload) => {
  if (io) io.to(`user:${userId}`).emit(event, payload);
};
exports.broadcastAll = (event, payload) => {
  if (io) io.emit(event, payload);
};
