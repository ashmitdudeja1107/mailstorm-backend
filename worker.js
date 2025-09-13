const { Resend } = require('resend');
require('dotenv').config();

// Validate required environment variables
if (!process.env.RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY is required in environment variables');
}

if (!process.env.FROM_EMAIL) {
  throw new Error('FROM_EMAIL is required in environment variables');
}

// Create Resend instance
const resend = new Resend(process.env.RESEND_API_KEY);

// Create a compatible transporter interface for your existing code
const createTransporter = () => {
  return {
    sendMail: async (mailOptions) => {
      try {
        console.log(`📧 Sending email via Resend to: ${mailOptions.to}`);
        
        const { data, error } = await resend.emails.send({
          from: mailOptions.from,
          to: [mailOptions.to],
          subject: mailOptions.subject,
          html: mailOptions.html,
          text: mailOptions.text || mailOptions.html?.replace(/<[^>]*>/g, ''),
        });

        if (error) {
          console.error('❌ Resend API error:', error);
          throw new Error(`Resend API error: ${error.message}`);
        }

        console.log(`✅ Email sent successfully via Resend. ID: ${data.id}`);
        return { messageId: data.id };
      } catch (error) {
        console.error('❌ Failed to send email via Resend:', error);
        throw error;
      }
    },

    verify: async () => {
      console.log('✅ Resend transporter configured');
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
    return true;
  } catch (error) {
    console.error('❌ Resend transporter verification failed:', error);
    throw error;
  }
};

module.exports = {
  transporter,
  verifyTransporter,
  resend
};
