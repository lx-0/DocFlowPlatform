const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const healthRoutes = require('../routes/health');
const authRoutes = require('../routes/auth');
const documentRoutes = require('../routes/documents');
const routingRulesRoutes = require('../routes/routingRules');
const approvalsRoutes = require('../routes/approvals');
const adminRoutes = require('../routes/admin');
const v1Routes = require('../routes/v1');
const metricsAggregator = require('../jobs/metricsAggregator');

const app = express();

metricsAggregator.register();

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Restrict to the configured origin (or same-origin in production).
// External API v1 routes use API key auth, so they are exempted.
const corsOrigin = process.env.CORS_ORIGIN || false; // false = same-origin only
app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/routing-rules', routingRulesRoutes);
app.use('/api/approvals', approvalsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/v1', v1Routes);

module.exports = app;
