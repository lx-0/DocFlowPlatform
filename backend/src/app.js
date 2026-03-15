const express = require('express');
const path = require('path');
const healthRoutes = require('../routes/health');
const authRoutes = require('../routes/auth');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/', healthRoutes);
app.use('/api/auth', authRoutes);

module.exports = app;
