const { Worker } = require('bullmq');
const redisConnection = require('./config/redis');
const { transporter } = require('./config/email');
const Campaign = require('./models/Campaign');
const Recipient = require('./models/Recipient');
require('dotenv').config();

// Create worker
const emailWorker = new Worker('email-queue', async (job) => {
  const { campaignId, recipientId, to, name, subject, body, userId } = job.data;
  
  try {
    console.log(`Processing email job for recipient: ${to}`);
    
    // Validate required parameters
    if (!campaignId || !recipientId || !to || !subject || !userId) {
      throw new Error('Missing required job parameters: campaignId, recipientId, to, subject, or userId');
    }
    
    if (!body) {
      throw new Error('Email body is required but was not provided');
    }
    
    // Check if campaign is still active
    const campaign = await Campaign.findById(campaignId, userId);
    if (!campaign || campaign.status === 'paused') {
      throw new Error('Campaign is not active or not found');
    }

    // Personalize email content
    let personalizedBody = body;
    if (name && typeof body === 'string') {
      personalizedBody = body.replace(/\{name\}/g, name);
    }

    // Send email
    const mailOptions = {
      from: `${process.env.FROM_NAME} <${process.env.FROM_EMAIL}>`,
      to: to,
      subject: subject,
      html: personalizedBody,
      text: personalizedBody.replace(/<[^>]*>/g, '') // Strip HTML for text version
    };

    await transporter.sendMail(mailOptions);
    
    // Update recipient status
    await Recipient.updateStatus(recipientId, 'sent', userId);
    
    console.log(`Email sent successfully to: ${to}`);
    
    // Check if all emails for this campaign are sent
    await checkCampaignCompletion(campaignId, userId);
    
    return { success: true, message: `Email sent to ${to}` };
  } catch (error) {
    console.error(`Failed to send email to ${to}:`, error);
    
    // Update recipient status with error
    await Recipient.updateStatus(recipientId, 'failed', userId, error.message);
    
    // Check if all emails for this campaign are processed
    await checkCampaignCompletion(campaignId, userId);
    
    throw error;
  }
}, {
  connection: redisConnection,
  concurrency: 5, // Process 5 emails concurrently
  limiter: {
    max: 100, // Max 100 emails per hour
    duration: 60 * 60 * 1000, // 1 hour
  },
});

// Function to check if campaign is completed
async function checkCampaignCompletion(campaignId, userId) {
  try {
    console.log(`Checking campaign completion for campaign ${campaignId}`);
    
    // Get all pending recipients for this campaign
    const pendingRecipients = await Recipient.getPendingByCampaignId(campaignId, userId);
    console.log(`Found ${pendingRecipients.length} pending recipients for campaign ${campaignId}`);
    
    if (pendingRecipients.length === 0) {
      // All emails processed, update campaign status to completed
      console.log(`All emails processed for campaign ${campaignId}, marking as completed`);
      await Campaign.updateStatus(campaignId, 'completed', userId);
      console.log(`✅ Campaign ${campaignId} marked as COMPLETED`);
      
      // Get final stats
      const stats = await Campaign.getCampaignStats(campaignId, userId);
      console.log(`Final stats for campaign ${campaignId}:`, {
        total: stats.total_recipients,
        sent: stats.sent_count,
        failed: stats.failed_count
      });
    } else {
      console.log(`Campaign ${campaignId} still has ${pendingRecipients.length} pending emails`);
    }
  } catch (error) {
    console.error(`❌ Error checking campaign completion for ${campaignId}:`, error);
  }
}

// Worker event handlers
emailWorker.on('ready', () => {
  console.log('Email worker is ready');
});

emailWorker.on('active', (job) => {
  console.log(`Job ${job.id} is now active`);
});

emailWorker.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed with result:`, result);
});

emailWorker.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed with error:`, err);
});

emailWorker.on('error', (err) => {
  console.error('Worker error:', err);
});

process.on('SIGINT', async () => {
  console.log('Shutting down worker...');
  await emailWorker.close();
  process.exit(0);
});

console.log('Email worker started successfully');