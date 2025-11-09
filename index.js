const express = require("express");
const cors = require("cors");
const bodyParser = require('body-parser');
const { initDB } = require('./config/database');
require("dotenv").config();

// Import route handlers
const authRoutes = require("./routes/authRoutes");
const campaignRoutes = require('./routes/campaigns');
const openTrackingRoutes = require('./routes/opens');

// Import authentication middleware
const googleAuthMiddleware = require('./middleware/googleAuthMiddleware'); // Adjust path as needed

const app = express();

// CORS configuration
app.use(cors({
  origin: [
    "https://mailstorn.onrender.com",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://13.232.248.97",
    "http://localhost:3000"
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.options("*", cors());

// Middleware
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Trust proxy for accurate IP addresses
app.set('trust proxy', true);

// Test endpoint (public - no auth required)
app.get("/api/message", (req, res) => {
  res.json({ message: "Hello from backend!" });
});

// Health check endpoints (public - no auth required)
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
// Auth routes (public - no protection needed for login/signup)
app.use("/api/auth", authRoutes);

// 🔒 PROTECTED MAIL SERVICE ROUTES - Only approved users can access
// These routes require manual_check = true
app.use('/api/campaigns', campaignRoutes);
app.use('/api/opens',  openTrackingRoutes);

// You can add more protected routes here as needed:
// app.use('/api/recipients', googleAuthMiddleware, recipientRoutes);
// app.use('/api/analytics', googleAuthMiddleware, analyticsRoutes);
// app.use('/api/templates', googleAuthMiddleware, templateRoutes);

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
      console.log(`📊 🔒 Protected Campaigns service: http://localhost:${PORT}/api/campaigns`);
      console.log(`📈 🔒 Protected Opens tracking: http://localhost:${PORT}/api/opens`);
      console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('🛡️  Mail services protected by manual approval system');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;


