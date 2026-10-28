// Local development server for the Vercel-compatible API. Production uses api/*.js.
require('dotenv').config();
const express = require('express');
const path = require('path');
const { apiHandler } = require('./lib/api-handler');

const app = express();
app.use(express.json({ limit: '32kb' }));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build')));
app.use('/api', (req, res) => apiHandler(req, res));
app.use(express.static(path.join(__dirname, 'public')));
const port = Number(process.env.PORT) || 3001;
app.listen(port, '0.0.0.0', () => console.log(`Pit Stop Protocol running at http://localhost:${port}`));
