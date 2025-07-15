const nodemailer = require('nodemailer');
require('dotenv').config();

// Create transporter based on environment variables
const createTransporter = () => {
  if (process.env.SENDGRID_API_KEY) {
    // SendGrid configuration
    return nodemailer.createTransport({
      service: 'SendGrid',
      auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY
      }
    });
  } else {
    // SMTP configuration (Gmail, etc.)
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
};

const transporter = createTransporter();

// Verify transporter configuration
const verifyTransporter = async () => {
  try {
    await transporter.verify();
    console.log('Email transporter verified successfully');
  } catch (error) {
    console.error('Email transporter verification failed:', error);
  }
};

module.exports = {
  transporter,
  verifyTransporter
};