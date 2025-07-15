const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();

const admin = require("../config/firebase");
const { createUser, getUserByEmail } = require("../models/userModel");

// Signup route


// Run this once to generate the correct hash for "rt12"






// GOOGLE SIGNUP ROUTE
router.post("/google-signup", async (req, res) => {
  try {
    console.log("Google signup request received:", req.body);
    
    const { token } = req.body;

    if (!token) {
      console.log("No token provided");
      return res.status(400).json({ message: "Token is required" });
    }

    console.log("Verifying Firebase token...");
    const decoded = await admin.auth().verifyIdToken(token);
    console.log("Token decoded successfully:", { 
      email: decoded.email, 
      name: decoded.name || decoded.displayName 
    });
    
    const email = decoded.email;
    const name = decoded.name || decoded.displayName || "Unnamed User";

    console.log("Checking for existing user with email:", email);
    const existingUser = await getUserByEmail(email);
    
    if (existingUser) {
      console.log("User already exists:", existingUser.email);
      return res.status(409).json({ message: "User already exists" });
    }

    console.log("Creating new user:", { name, email });
    // For Google users, we don't pass a password (will use placeholder)
    const newUser = await createUser(name, email);
    console.log("User created successfully:", newUser);

    console.log("Database insertion result:", newUser);
    
    // Return user data WITHOUT password
    res.status(201).json({ 
      message: "Google signup successful", 
      user: {
        user_id: newUser.id,
        name: newUser.name,
        email: newUser.email
      }
    });
  } catch (error) {
    console.error("Google signup error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    // More specific error handling
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ message: "Token expired" });
    } else if (error.code === 'auth/invalid-id-token') {
      return res.status(401).json({ message: "Invalid token format" });
    } else if (error.code === 'auth/id-token-revoked') {
      return res.status(401).json({ message: "Token revoked" });
    }
    
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});
// GOOGLE LOGIN ROUTE
router.post("/google-login", async (req, res) => {
  try {
    console.log("Google login request received:", req.body);
    
    const { token } = req.body;

    if (!token) {
      console.log("No token provided");
      return res.status(400).json({ message: "Token is required" });
    }

    console.log("Verifying Firebase token...");
    const decoded = await admin.auth().verifyIdToken(token);
    console.log("Token decoded successfully:", { 
      email: decoded.email, 
      name: decoded.name || decoded.displayName 
    });
    
    const email = decoded.email;

    console.log("Checking for existing user with email:", email);
    const existingUser = await getUserByEmail(email);
    
    if (!existingUser) {
      console.log("User not found");
      return res.status(404).json({ message: "User not found. Please sign up first." });
    }

    // Check if this is indeed a Google OAuth user
    if (existingUser.password !== 'GOOGLE_OAUTH_USER') {
      return res.status(400).json({ 
        message: "This account uses email/password login. Please use your password to log in." 
      });
    }

    console.log("Google login successful");
    
    // Return user data
    res.status(200).json({ 
      message: "Google login successful", 
      token:token,
      user: {
        id: existingUser.id,
        name: existingUser.name,
        email: existingUser.email,
      
      }
    });
  } catch (error) {
    console.error("Google login error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    // More specific error handling
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ message: "Token expired" });
    } else if (error.code === 'auth/invalid-id-token') {
      return res.status(401).json({ message: "Invalid token format" });
    } else if (error.code === 'auth/id-token-revoked') {
      return res.status(401).json({ message: "Token revoked" });
    }
    
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

module.exports = router;