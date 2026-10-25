const mongoose = require('mongoose');

const placeSchema = new mongoose.Schema(
  { address: String, latitude: { type: Number, required: true }, longitude: { type: Number, required: true }, emergencyPhone: String },
  { _id: false }
);

const STATUSES = ['SEARCHING', 'DRIVER_ASSIGNED', 'ACCEPTED', 'DRIVER_ARRIVING',
  'ARRIVED', 'TRIP_STARTED', 'COMPLETED', 'CANCELLED'];

const bookingSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' },
    ambulanceType: { type: String, enum: ['BASIC', 'ICU', 'ADVANCED'], default: 'BASIC' },
    pickupLocation: { type: placeSchema, required: true },
    destination: { type: placeSchema, required: true },
    status: { type: String, enum: STATUSES, default: 'SEARCHING' },
    rejectedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Driver' }],
    cancelReason: String,
    etaMinutes: Number,
    distanceKm: Number,
    acceptedAt: Date,
    arrivedAt: Date,
    startedAt: Date,
    completedAt: Date,
    cancelledAt: Date,
  },
  { timestamps: true }
);

bookingSchema.index({ customerId: 1, createdAt: -1 });
bookingSchema.index({ driverId: 1, createdAt: -1 });

module.exports = mongoose.model('Booking', bookingSchema);
module.exports.STATUSES = STATUSES;
