const User = require('../models/User');
const { verifyToken } = require('../utils/jwt');
const { AppError, asyncHandler } = require('../utils/apiResponse');

/** Requires a valid "Authorization: Bearer <jwt>" header; sets req.user. */
exports.protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new AppError('Authentication required', 401);

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw new AppError('Invalid or expired token', 401);
  }
  const user = await User.findById(payload.id);
  if (!user) throw new AppError('User no longer exists', 401);
  req.user = user;
  next();
});
