const { AppError } = require('../utils/apiResponse');

exports.requireFields = (...fields) => (req, res, next) => {
  const missing = fields.filter((f) => req.body[f] === undefined || req.body[f] === null || req.body[f] === '');
  if (missing.length) return next(new AppError(`Missing fields: ${missing.join(', ')}`, 400));
  next();
};
