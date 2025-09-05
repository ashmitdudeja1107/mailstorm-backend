const { Pool } = require("pg");
require("dotenv").config();

console.log("Environment variables:");
console.log("DATABASE_URL:", process.env.DATABASE_URL ? "***" : "NOT SET");
console.log("NODE_ENV:", process.env.NODE_ENV || "NOT SET");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Always use SSL for Render
});

module.exports = pool;
