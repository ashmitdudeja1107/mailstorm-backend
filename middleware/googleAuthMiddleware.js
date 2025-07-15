const admin = require('firebase-admin'); // Make sure Firebase Admin is properly configured
const { getUserByEmail } = require('../models/userModel'); // Adjust path as needed

const googleAuthMiddleware = async (req, res, next) => {
  try {
    console.log("Google auth middleware triggered");
    
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log("No Bearer token provided");
      return res.status(401).json({ 
        success: false,
        message: "Authorization token is required" 
      });
    }

    const token = authHeader.split(' ')[1];
    
    if (!token) {
      console.log("No token provided");
      return res.status(401).json({ 
        success: false,
        message: "Token is required" 
      });
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
      return res.status(404).json({ 
        success: false,
        message: "User not found. Please sign up first." 
      });
    }

    // Check if this is indeed a Google OAuth user
    if (existingUser.password !== 'GOOGLE_OAUTH_USER') {
      return res.status(400).json({ 
        success: false,
        message: "This account uses email/password login. Please use your password to log in." 
      });
    }

    console.log("Google authentication successful");
    
    // Attach user data to request object
    req.user = {
      id: existingUser.id,
      name: existingUser.name,
      email: existingUser.email
    };
    
    // Set user_id for compatibility with existing code
    req.user_id = existingUser.id;
    
    next();
  } catch (error) {
    console.error("Google auth middleware error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    // More specific error handling
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ 
        success: false,
        message: "Token expired" 
      });
    } else if (error.code === 'auth/invalid-id-token') {
      return res.status(401).json({ 
        success: false,
        message: "Invalid token format" 
      });
    } else if (error.code === 'auth/id-token-revoked') {
      return res.status(401).json({ 
        success: false,
        message: "Token revoked" 
      });
    }
    
    return res.status(500).json({ 
      success: false,
      message: "Internal server error", 
      error: error.message 
    });
  }
};

module.exports = googleAuthMiddleware;