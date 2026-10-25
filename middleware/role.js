const { AppError } = require('../utils/apiResponse');

exports.requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(new AppError('Forbidden for your role', 403));
