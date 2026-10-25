const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    ambulanceNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    licenseNumber: { type: String, required: true, trim: true },
    ambulanceType: { type: String, enum: ['BASIC', 'ICU', 'ADVANCED'], default: 'BASIC' },
    vehicleModel: String,
    vehicleYear: Number,
    isAvailable: { type: Boolean, default: false }, // Online/Offline switch; false while on a trip
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
    },
    lastLocationAt: Date,
    rating: { type: Number, default: 5 },
    totalTrips: { type: Number, default: 0 },
  },
  { timestamps: true }
);

driverSchema.index({ location: '2dsphere' });

/** Client-friendly shape: exposes latitude/longitude as the spec describes. */
driverSchema.methods.toClient = function toClient() {
  const user = this.userId && this.userId.fullName ? this.userId : null;
  return {
    id: this.id,
    name: user ? user.fullName : undefined,
    phone: user ? user.phone : undefined,
    ambulanceNumber: this.ambulanceNumber,
    ambulanceType: this.ambulanceType,
    vehicleModel: this.vehicleModel,
    rating: this.rating,
    totalTrips: this.totalTrips,
    isAvailable: this.isAvailable,
    latitude: this.location.coordinates[1],
    longitude: this.location.coordinates[0],
  };
};

module.exports = mongoose.model('Driver', driverSchema);
