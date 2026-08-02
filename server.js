'use strict';

const http = require('http');
const createApp = require('./src/app');
const { initWebSocket } = require('./src/lib/websocket');
const { PORT } = require('./src/config/env');

const app = createApp();
const server = http.createServer(app);

// Initialize WebSocket server attached to the HTTP server
initWebSocket(server);

server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`        IMUTFLIX BACKEND API SERVER RUNNING       `);
  console.log(`==================================================`);
  console.log(`  - Local URL: http://localhost:${PORT}`);
  console.log(`  - Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`==================================================`);
});
