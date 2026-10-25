const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { port } = require('./config/env');
const connectDB = require('./config/db');
const initSocket = require('./socket');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/driver', require('./routes/driverRoutes'));
app.use('/api', require('./routes/bookingRoutes'));

app.use(notFound);
app.use(errorHandler);

const server = http.createServer(app);

if (require.main === module) {
  connectDB()
    .then(() => {
      initSocket(server);
      server.listen(port, () => console.log(`LifeLine API running on :${port}`));
    })
    .catch((err) => { console.error('Startup failed:', err); process.exit(1); });
}

module.exports = { app, server, initSocket };
