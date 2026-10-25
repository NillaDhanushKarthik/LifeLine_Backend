exports.notFound = (req, res) => res.status(404).json({ success: false, message: 'Route not found' });

// eslint-disable-next-line no-unused-vars
exports.errorHandler = (err, req, res, next) => {
  let status = err.statusCode || 500;
  let message = err.message;

  if (err.name === 'ValidationError') { status = 400; message = Object.values(err.errors).map((e) => e.message).join(', '); }
  else if (err.code === 11000) { status = 409; message = `${Object.keys(err.keyValue)[0]} already registered`; }
  else if (err.name === 'CastError') { status = 400; message = 'Invalid id'; }

  if (status === 500) { console.error(err); message = 'Internal server error'; }
  res.status(status).json({ success: false, message });
};
