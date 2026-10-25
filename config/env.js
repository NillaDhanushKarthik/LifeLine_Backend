require('dotenv').config();

['MONGO_URI', 'JWT_SECRET'].forEach((key) => {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
});

module.exports = {
  port: process.env.PORT || 5000,
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || '',
};
