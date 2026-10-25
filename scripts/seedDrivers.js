const mongoose = require('mongoose');
const User = require('../models/User');
const Driver = require('../models/Driver');
const { mongoUri } = require('../config/env');

const testDrivers = [
  {
    fullName: 'Ramesh Kumar (Ambulance #1)',
    phone: '9112233441',
    password: 'password123',
    ambulanceNumber: 'TS09AB1001',
    licenseNumber: 'DL-TS-2021-001',
    ambulanceType: 'BASIC',
    vehicleModel: 'Force Traveller',
    vehicleYear: 2023,
    location: { type: 'Point', coordinates: [78.4867, 17.3850] }, // Hyderabad
  },
  {
    fullName: 'Suresh Sharma (Ambulance #2)',
    phone: '9112233442',
    password: 'password123',
    ambulanceNumber: 'TS09AB1002',
    licenseNumber: 'DL-TS-2021-002',
    ambulanceType: 'ICU',
    vehicleModel: 'Tata Winger ICU',
    vehicleYear: 2024,
    location: { type: 'Point', coordinates: [78.4867, 17.3850] }, // Hyderabad
  },
  {
    fullName: 'Vikram Singh (Ambulance #3)',
    phone: '9112233443',
    password: 'password123',
    ambulanceNumber: 'TS09AB1003',
    licenseNumber: 'DL-TS-2021-003',
    ambulanceType: 'ADVANCED',
    vehicleModel: 'Mahindra Bolero Maxi',
    vehicleYear: 2023,
    location: { type: 'Point', coordinates: [78.4867, 17.3850] }, // Hyderabad
  },
  {
    fullName: 'Alex Rivera (Ambulance #4)',
    phone: '9112233444',
    password: 'password123',
    ambulanceNumber: 'CA01AM999',
    licenseNumber: 'DL-US-2022-777',
    ambulanceType: 'BASIC',
    vehicleModel: 'Ford Transit Ambulance',
    vehicleYear: 2023,
    location: { type: 'Point', coordinates: [-122.0841, 37.4220] }, // Android Emulator Googleplex
  },
];

async function seed() {
  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB for seeding drivers...');

    for (const data of testDrivers) {
      let user = await User.findOne({ phone: data.phone });
      if (!user) {
        user = await User.create({
          fullName: data.fullName,
          phone: data.phone,
          password: data.password,
          role: 'driver',
        });
        console.log(`Created driver user: ${user.fullName} (${user.phone})`);
      } else {
        user.fullName = data.fullName;
        user.role = 'driver';
        await user.save();
        console.log(`Updated driver user: ${user.fullName} (${user.phone})`);
      }

      let driver = await Driver.findOne({ userId: user._id });
      if (!driver) {
        driver = await Driver.create({
          userId: user._id,
          ambulanceNumber: data.ambulanceNumber,
          licenseNumber: data.licenseNumber,
          ambulanceType: data.ambulanceType,
          vehicleModel: data.vehicleModel,
          vehicleYear: data.vehicleYear,
          isAvailable: true,
          location: data.location,
          rating: 4.9,
          totalTrips: 15,
        });
        console.log(`Created driver profile for ${data.ambulanceNumber} (${data.ambulanceType})`);
      } else {
        driver.isAvailable = true;
        driver.ambulanceType = data.ambulanceType;
        driver.ambulanceNumber = data.ambulanceNumber;
        driver.location = data.location;
        await driver.save();
        console.log(`Updated driver profile for ${data.ambulanceNumber} - Online and Available`);
      }
    }

    const totalDrivers = await Driver.countDocuments({ isAvailable: true });
    console.log(`Seeding complete! Total available drivers online: ${totalDrivers}`);
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
}

seed();
