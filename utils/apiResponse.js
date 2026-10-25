/** Operational error with an HTTP status, handled by errorHandler middleware. */
class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Wraps async route handlers so rejected promises reach errorHandler. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const ok = (res, data = {}, status = 200) => res.status(status).json({ success: true, ...data });

module.exports = { AppError, asyncHandler, ok };
