const { Pool } = require("pg");
require("dotenv").config();

console.log("Environment variables:");
console.log("DATABASE_URL:", process.env.DATABASE_URL ? "***" : "NOT SET");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

module.exports = pool;
