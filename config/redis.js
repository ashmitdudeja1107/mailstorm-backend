const Redis = require('ioredis');
require('dotenv').config();

// Debug environment variables
console.log('=== ENVIRONMENT VARIABLES DEBUG ===');
console.log('REDIS_HOST:', process.env.REDIS_HOST);
console.log('REDIS_PORT:', process.env.REDIS_PORT);
console.log('REDIS_PASSWORD:', process.env.REDIS_PASSWORD ? '[MASKED]' : 'undefined');
console.log('REDIS_DB:', process.env.REDIS_DB);
console.log('NODE_ENV:', process.env.NODE_ENV);

// Redis connection config (for ioredis + bullmq)
const redisConfig = {
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD,
  db: 0,
  tls: {
    servername: process.env.REDIS_HOST
  },
  connectTimeout: 60000,
  commandTimeout: 15000,
  keepAlive: 10000,
  family: 4,
  noDelay: true,
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 2000,
  retryDelayOnClusterDown: 2000,
  enableReadyCheck: true,
  maxLoadingTimeout: 10000,
  retryStrategy: (times) => {
    console.log(`Retry attempt ${times}`);
    if (times > 5) return null;
    return times * 2000;
  }
};

// Create the actual Redis connection instance
const redis = new Redis(redisConfig);

// Connection tracking
let connectionAttempts = 0;
let lastConnectionTime = null;
let isConnected = false;

// Event listeners
redis.on('connect', () => {
  connectionAttempts++;
  lastConnectionTime = new Date();
  console.log(`✅ Redis connected successfully (attempt #${connectionAttempts}) at ${lastConnectionTime.toISOString()}`);
  console.log(`Connected to: ${redisConfig.host}:${redisConfig.port}`);
});

redis.on('ready', () => {
  isConnected = true;
  console.log('✅ Redis ready for commands');
});

redis.on('error', (err) => {
  isConnected = false;
  console.error('❌ Redis error:', err.message);
});

redis.on('close', () => {
  isConnected = false;
  const duration = lastConnectionTime ? Date.now() - lastConnectionTime : 0;
  console.log(`❌ Redis connection closed. Lasted: ${duration}ms`);
});

redis.on('end', () => {
  isConnected = false;
  console.log('❌ Redis connection ended');
});

redis.on('reconnecting', (delay) => {
  console.log(`🔄 Redis reconnecting in ${delay}ms`);
});

// Health check utility
const checkHealth = async () => {
  try {
    const start = Date.now();
    await redis.ping();
    const latency = Date.now() - start;
    console.log(`✅ Redis health check OK (${latency}ms)`);
    return { healthy: true, latency };
  } catch (err) {
    console.error('❌ Redis health check failed:', err.message);
    return { healthy: false, error: err.message };
  }
};

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  console.log(`\n🛑 Received ${signal}, closing Redis connection...`);
  try {
    await redis.quit();
    console.log('✅ Redis closed gracefully');
  } catch (err) {
    console.error('❌ Error during Redis shutdown:', err.message);
    redis.disconnect();
  }
  process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Export both the redis instance and the config object
module.exports = {
  redis,           // For general Redis usage
  redisConfig,     // For BullMQ usage
  checkHealth,
  isConnected: () => isConnected
};
