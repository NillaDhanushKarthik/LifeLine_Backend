const { Server } = require('socket.io');
const User = require('../models/User');
const { verifyToken } = require('../utils/jwt');
const { setIO } = require('./emitter');
const registerDriverHandlers = require('./driverHandlers');

/** Attaches Socket.IO to the HTTP server. Clients connect with { auth: { token } }. */
module.exports = function initSocket(httpServer) {
  const io = new Server(httpServer, { cors: { origin: '*' } });
  setIO(io);

  // JWT handshake: reject unauthenticated sockets.
  io.use(async (socket, next) => {
    try {
      const { id } = verifyToken(socket.handshake.auth && socket.handshake.auth.token);
      const user = await User.findById(id);
      if (!user) throw new Error('no user');
      socket.user = user;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    // One private room per user. All server emits target `user:<id>`.
    socket.join(`user:${socket.user.id}`);
    if (socket.user.role === 'driver') registerDriverHandlers(socket);
  });

  return io;
};
