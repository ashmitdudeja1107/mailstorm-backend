const express = require("express");
const cors = require("cors");
const bodyParser = require('body-parser');
const { initDB } = require('./config/database');
require("dotenv").config();

// Import route handlers
const authRoutes = require("./routes/authRoutes");

const campaignRoutes = require('./routes/campaigns');
const openTrackingRoutes = require('./routes/opens');

const app = express();

// CORS configuration
app.use(cors({
  origin: ['https://mailstorn.onrender.com', 'http://127.0.0.1:5500', 'http://localhost:5500'],
  credentials: true
}));

// Middleware
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Trust proxy for accurate IP addresses
app.set('trust proxy', true);

// Test endpoint
app.get("/api/message", (req, res) => {
  res.json({ message: "Hello from backend!" });
});

// Health check endpoints
app.get("/api/health", (req, res) => {
  res.json({ 
    message: "Server is running",
    status: "healthy",
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'MailStorm API'
  });
});

// Mount routes
app.use("/api/auth", authRoutes);

app.use('/api/campaigns', campaignRoutes);
app.use('/api/opens', openTrackingRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error("Global error handler:", err.stack);
  res.status(500).json({ 
    message: "Something went wrong!",
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler for unmatched routes - Must be AFTER all route definitions
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ 
      message: "API endpoint not found",
      endpoint: req.originalUrl
    });
  } else {
    res.status(404).json({ message: "Page not found" });
  }
});

// Initialize database and start server
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await initDB();
    console.log('Database initialized successfully');
    
    app.listen(PORT, () => {
      console.log(`🚀 MailStorm API server running on port ${PORT}`);
    
      console.log(`🔐 Auth service available at: http://localhost:${PORT}/api/auth`);
      console.log(`📊 Campaigns service available at: http://localhost:${PORT}/api/campaigns`);
      console.log(`📈 Opens tracking available at: http://localhost:${PORT}/api/opens`);
      console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;