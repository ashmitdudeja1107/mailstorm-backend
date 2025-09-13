const { Resend } = require('resend');
require('dotenv').config();

// Create Resend instance
const resend = new Resend(process.env.RESEND_API_KEY);

// Create a compatible transporter interface for your existing code
const createTransporter = () => {
  return {
    sendMail: async (mailOptions) => {
      try {
        const { data, error } = await resend.emails.send({
          from: mailOptions.from,
          to: [mailOptions.to],
          subject: mailOptions.subject,
          html: mailOptions.html,
          text: mailOptions.text,
        });

        if (error) {
          throw new Error(error.message);
        }

        return { messageId: data.id };
      } catch (error) {
        throw error;
      }
    },

    verify: async () => {
      // Resend doesn't have a verify method, so we'll just return true
      return true;
    }
  };
};

const transporter = createTransporter();

// Verify transporter configuration
const verifyTransporter = async () => {
  try {
    await transporter.verify();
    console.log('✅ Resend transporter ready');
  } catch (error) {
    console.error('❌ Resend transporter verification failed:', error);
  }
};

module.exports = {
  transporter,
  verifyTransporter
};
