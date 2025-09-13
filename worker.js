const { Worker } = require('bullmq');
const { redisConfig } = require('./config/redis'); // ✅ Use redisConfig for BullMQ
const { transporter } = require('./config/email');
const Campaign = require('./models/Campaign');
const Recipient = require('./models/Recipient');
require('dotenv').config();

// Create worker
const emailWorker = new Worker('email-queue', async (job) => {
  const { campaignId, recipientId, to, name, subject, body, userId } = job.data;

  try {
    console.log(`Processing email job for recipient: ${to}`);

    if (!campaignId || !recipientId || !to || !subject || !userId) {
      throw new Error('Missing required job parameters: campaignId, recipientId, to, subject, or userId');
    }

    if (!body) {
      throw new Error('Email body is required but was not provided');
    }

    const campaign = await Campaign.findById(campaignId, userId);
    if (!campaign || campaign.status === 'paused') {
      throw new Error('Campaign is not active or not found');
    }

    let personalizedBody = body;
    if (name && typeof body === 'string') {
      personalizedBody = body.replace(/\{name\}/g, name);
    }

    const mailOptions = {
      from: `${process.env.FROM_NAME} <${process.env.FROM_EMAIL}>`,
      to,
      subject,
      html: personalizedBody,
      text: personalizedBody.replace(/<[^>]*>/g, '')
    };

    await transporter.sendMail(mailOptions);

    await Recipient.updateStatus(recipientId, 'sent', userId);

    console.log(`Email sent successfully to: ${to}`);

    await checkCampaignCompletion(campaignId, userId);

    return { success: true, message: `Email sent to ${to}` };
  } catch (error) {
    console.error(`Failed to send email to ${to}:`, error);

    await Recipient.updateStatus(recipientId, 'failed', userId, error.message);

    await checkCampaignCompletion(campaignId, userId);

    throw error;
  }
}, {
  connection: redisConfig, // ✅ This avoids ECONNREFUSED
  concurrency: 5,
  limiter: {
    max: 100,
    duration: 60 * 60 * 1000,
  },
});

// Function to check if campaign is completed
async function checkCampaignCompletion(campaignId, userId) {
  try {
    console.log(`Checking campaign completion for campaign ${campaignId}`);

    const pendingRecipients = await Recipient.getPendingByCampaignId(campaignId, userId);
    console.log(`Found ${pendingRecipients.length} pending recipients for campaign ${campaignId}`);

    if (pendingRecipients.length === 0) {
      console.log(`All emails processed for campaign ${campaignId}, marking as completed`);
      await Campaign.updateStatus(campaignId, 'completed', userId);
      console.log(`✅ Campaign ${campaignId} marked as COMPLETED`);

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
  console.log('✅ Email worker is ready');
});

emailWorker.on('active', (job) => {
  console.log(`🔄 Job ${job.id} is now active`);
});

emailWorker.on('completed', (job, result) => {
  console.log(`✅ Job ${job.id} completed with result:`, result);
});

emailWorker.on('failed', (job, err) => {
  console.error(`❌ Job ${job.id} failed with error:`, err);
});

emailWorker.on('error', (err) => {
  console.error('❌ Worker error:', err);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down worker...');
  await emailWorker.close();
  process.exit(0);
});

console.log('🚀 Email worker started successfully');
