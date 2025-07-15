const pool = require("../config/db");
const bcrypt = require('bcrypt');


// Add this helper function
async function generateUniqueId() {
  let attempts = 0;
  const maxAttempts = 100;
  
  while (attempts < maxAttempts) {
    // Generate random 3-4 digit number (100-9999)
    const randomId = Math.floor(Math.random() * 9900) + 100;
    
    // Check if this ID already exists
    const checkQuery = 'SELECT id FROM users WHERE id = $1 LIMIT 1';
    const result = await pool.query(checkQuery, [randomId]);
    
    if (result.rows.length === 0) {
      return randomId;
    }
    
    attempts++;
  }
  
  throw new Error('Unable to generate unique ID after maximum attempts');
}
// Modify your existing createUser function to use custom ID
async function createUser(name, email, password = null) {
  const uniqueId = await generateUniqueId();
  
  // Insert with custom ID instead of letting it auto-increment
  const query = `
    INSERT INTO users (id, name, email, password)
    VALUES ($1, $2, $3, $4)
    RETURNING id, name, email
  `;
  
  const hashedPassword = password ? await bcrypt.hash(password, 10) : 'GOOGLE_OAUTH_USER';
  const values = [uniqueId, name, email, hashedPassword];
  
  const result = await pool.query(query, values);
  return result.rows[0];
};

const getUserByEmail = async (email) => {
  try {
    console.log("Searching for user with email:", email);
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    console.log("Query result:", result.rows.length > 0 ? "User found" : "User not found");
    return result.rows[0];
  } catch (error) {
    console.error("Database error in getUserByEmail:", error);
    throw error;
  }
};

const getUserById = async (id) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return result.rows[0];
  } catch (error) {
    console.error("Database error in getUserById:", error);
    throw error;
  }
};

// Update password function
const updatePassword = async (userId, hashedPassword) => {
  try {
    const query = "UPDATE users SET password = $1 WHERE id = $2";
    await pool.query(query, [hashedPassword, userId]);
    return true;
  } catch (error) {
    console.error("Database error in updatePassword:", error);
    throw error;
  }
};

// Update phone number function
const updatePhoneNumber = async (userId, phoneNumber) => {
  try {
    const query = "UPDATE users SET phone_number = $1 WHERE id = $2";
    await pool.query(query, [phoneNumber, userId]);
    return true;
  } catch (error) {
    console.error("Database error in updatePhoneNumber:", error);
    throw error;
  }
};

// Get user by phone number
const getUserByPhone = async (phoneNumber) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE phone_number = $1", [phoneNumber]);
    return result.rows[0];
  } catch (error) {
    console.error("Database error in getUserByPhone:", error);
    throw error;
  }
};

module.exports = { 
  createUser, 
  getUserByEmail, 
  getUserById, 
  updatePassword, 
  updatePhoneNumber, 
  getUserByPhone 
};