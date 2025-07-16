const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const { Queue } = require('bullmq');
const { redisConfig } = require('../config/redis'); // ✅ Updated
const { getCampaignAnalytics } = require('../config/database');
const Campaign = require('../models/Campaign');
const Recipient = require('../models/Recipient');
const EmailOpen = require('../models/EmailOpen');
const EmailTrackingService = require('../services/EmailTrackingService');
const googleAuthMiddleware = require('../middleware/googleAuthMiddleware');
const { pool } = require('../config/database');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });
const emailTrackingService = new EmailTrackingService();

// ✅ Use redisConfig for BullMQ connection
const emailQueue = new Queue('email-queue', {
  connection: redisConfig,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

// PUBLIC ROUTES (no authentication required)
// These routes should be placed BEFORE the middleware

// View full email message (publicly accessible - no authentication required)
// Fixed route - check for both possible field names
// Updated view route (your existing route stays the same)
router.get('/:campaignId/view/:recipientId', async (req, res) => {
  try {
    const { campaignId, recipientId } = req.params;
    
    // Validate input parameters
    if (!campaignId || !recipientId || isNaN(campaignId) || isNaN(recipientId)) {
      return res.status(400).send('<h1>Invalid Parameters</h1><p>The campaign ID or recipient ID is invalid.</p>');
    }
    
    // Use public methods that don't filter by user_id
    const campaign = await Campaign.findByIdPublic(campaignId);
    const recipient = await Recipient.findByIdPublic(recipientId);
    
    if (!campaign || !recipient) {
      return res.status(404).send('<h1>Not Found</h1><p>The requested email message could not be found.</p>');
    }

    // Check for both possible field names
    const recipientCampaignId = recipient.campaignId || recipient.campaign_id;
    
    console.log('Debug: recipientCampaignId =', recipientCampaignId);
    console.log('Debug: expected campaignId =', parseInt(campaignId));
    
    // Verify that the recipient belongs to this campaign
    if (!recipientCampaignId || recipientCampaignId != campaignId) {
      console.log('❌ ACCESS DENIED - Recipient campaign mismatch');
      return res.status(403).send('<h1>Access Denied</h1><p>You are not authorized to view this message.</p>');
    }

    // Track the email open when viewing full message using public method
    try {
      await EmailOpen.createPublic({
        campaignId: parseInt(campaignId),
        recipientId: parseInt(recipientId),
        userId: campaign.user_id,
        openedAt: new Date()
      });
    } catch (trackingError) {
      console.error('Error tracking email open:', trackingError);
    }

    // Generate and return the full email view
    const fullEmailHtml = emailTrackingService.generateFullEmailView(campaign, recipient);
    
    // Add security headers
    res.set({
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'X-XSS-Protection': '1; mode=block'
    });
    
    res.send(fullEmailHtml);
    
  } catch (error) {
    console.error('Error viewing full email:', error);
    res.status(500).send('<h1>Server Error</h1><p>An error occurred while loading the message.</p>');
  }
});

// Updated unsubscribe route (simplified without token)
router.get('/unsubscribe/:campaignId/:recipientId', async (req, res) => {
  try {
    const { campaignId, recipientId } = req.params;
    
    // Validate input parameters
    if (!campaignId || !recipientId || isNaN(campaignId) || isNaN(recipientId)) {
      return res.status(400).send('<h1>Invalid Parameters</h1><p>The unsubscribe link is invalid.</p>');
    }
    
    // Find the recipient
    const recipient = await Recipient.findByIdPublic(recipientId);
    
    if (!recipient) {
      return res.status(404).send('<h1>Not Found</h1><p>The recipient could not be found.</p>');
    }

    // Check if recipient belongs to this campaign
    const recipientCampaignId = recipient.campaignId || recipient.campaign_id;
    if (!recipientCampaignId || recipientCampaignId != campaignId) {
      return res.status(403).send('<h1>Access Denied</h1><p>Invalid unsubscribe request.</p>');
    }

    // Update recipient status to unsubscribed
    await Recipient.updateUnsubscribeStatus(recipientId, true);
    
    // Return success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Unsubscribed Successfully</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            line-height: 1.6; 
            margin: 0; 
            padding: 20px; 
            background-color: #f4f4f4; 
            text-align: center;
          }
          .container { 
            max-width: 600px; 
            margin: 50px auto; 
            background: white; 
            padding: 40px; 
            border-radius: 8px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
          }
          .success-icon { 
            font-size: 48px; 
            color: #28a745; 
            margin-bottom: 20px; 
          }
          h1 { 
            color: #333; 
            margin-bottom: 20px; 
          }
          p { 
            color: #666; 
            font-size: 16px; 
            margin-bottom: 15px; 
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">✓</div>
          <h1>Successfully Unsubscribed</h1>
          <p>You have been successfully unsubscribed from our email list.</p>
          <p>You will no longer receive emails from this campaign.</p>
          <p>If you unsubscribed by mistake, please contact us to resubscribe.</p>
        </div>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('Error unsubscribing:', error);
    res.status(500).send('<h1>Server Error</h1><p>An error occurred while processing your unsubscribe request.</p>');
  }
});

module.exports = router;
router.use(googleAuthMiddleware);

router.get('/', async (req, res) => {
  try {
    const user_id = req.user_id;
    
    // Get all campaigns for the user
    const campaignsResult = await pool.query(`
      SELECT * FROM campaigns 
      WHERE user_id = $1 
      ORDER BY created_at DESC
    `, [user_id]);
    
    const campaigns = campaignsResult.rows;
    
    const campaignsWithStats = await Promise.all(
      campaigns.map(async (campaign) => {
        const analytics = await getCampaignAnalytics(campaign.id, user_id);
        
        // Get participant emails with recipient-level analytics
        const participantsResult = await pool.query(`
          SELECT 
            r.email, 
            r.status,
            r.id as recipient_id,
            COALESCE(eo.open_count, 0) as recipient_opens,
            CASE WHEN eo.recipient_id IS NOT NULL THEN true ELSE false END as has_opened,
            eo.last_opened_at
          FROM recipients r
          LEFT JOIN (
            SELECT 
              recipient_id,
              COUNT(*) as open_count,
              MAX(opened_at) as last_opened_at
            FROM email_opens 
            WHERE campaign_id = $1 AND user_id = $2
            GROUP BY recipient_id
          ) eo ON r.id = eo.recipient_id
          WHERE r.campaign_id = $1 AND r.user_id = $2 AND r.email IS NOT NULL
          ORDER BY 
            CASE 
              WHEN r.status = 'sent' THEN 1
              WHEN r.status = 'pending' THEN 2
              ELSE 3
            END,
            r.email
        `, [campaign.id, user_id]);
        
        // Remove duplicates and include recipient-level analytics
        const uniqueParticipants = participantsResult.rows.reduce((acc, row) => {
          const existingParticipant = acc.find(item => item.email === row.email);
          if (!existingParticipant) {
            acc.push({ 
              email: row.email, 
              status: row.status,
              recipient_id: row.recipient_id,
              opens: row.recipient_opens,
              has_opened: row.has_opened,
              last_opened_at: row.last_opened_at
            });
          } else {
            // If duplicate email, keep the one with more opens or latest status
            if (row.recipient_opens > existingParticipant.opens) {
              existingParticipant.opens = row.recipient_opens;
              existingParticipant.has_opened = row.has_opened;
              existingParticipant.last_opened_at = row.last_opened_at;
              existingParticipant.status = row.status;
              existingParticipant.recipient_id = row.recipient_id;
            }
          }
          return acc;
        }, []);
        
        // Get total opens for campaign-level analytics
        const totalOpensQuery = `
          SELECT COUNT(*) as count 
          FROM email_opens 
          WHERE campaign_id = $1 AND user_id = $2
        `;
        const totalOpensResult = await pool.query(totalOpensQuery, [campaign.id, user_id]);
        const actualTotalOpens = parseInt(totalOpensResult.rows[0].count) || 0;
        
        return {
          ...campaign,
          participants: uniqueParticipants,
          analytics: {
            // Use actual_recipients from analytics, fallback to participants count
            total_recipients: analytics?.actual_recipients || uniqueParticipants.length || 0,
            sent_count: analytics?.sent_count || 0,
            open_rate: analytics?.open_rate || 0,
            unique_opens: analytics?.unique_opens || 0,
            total_opens: actualTotalOpens, // Campaign-level total opens
            failed_count: analytics?.failed_count || 0,
            pending_count: analytics?.pending_count || 0
          }
        };
      })
    );

    res.json({
      success: true,
      data: campaignsWithStats
    });
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch campaigns',
      error: error.message
    });
  }
});

// Get campaign by ID with comprehensive analytics
router.get('/:id', async (req, res) => {
  try {
    const campaignId = req.params.id;
    const user_id = req.user_id;
    const analytics = await getCampaignAnalytics(campaignId, user_id);
    
    if (!analytics) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch campaign',
      error: error.message
    });
  }
});

// Optional: Add a new route to get detailed recipient-level analytics
router.get('/:id/recipients', async (req, res) => {
  try {
    const campaignId = req.params.id;
    const user_id = req.user_id;
    
    // Get detailed recipient analytics
    const recipientsResult = await pool.query(`
      SELECT 
        r.id as recipient_id,
        r.email, 
        r.status,
        r.created_at as added_at,
        COALESCE(eo.open_count, 0) as total_opens,
        CASE WHEN eo.recipient_id IS NOT NULL THEN true ELSE false END as has_opened,
        eo.first_opened_at,
        eo.last_opened_at
      FROM recipients r
      LEFT JOIN (
        SELECT 
          recipient_id,
          COUNT(*) as open_count,
          MIN(opened_at) as first_opened_at,
          MAX(opened_at) as last_opened_at
        FROM email_opens 
        WHERE campaign_id = $1 AND user_id = $2
        GROUP BY recipient_id
      ) eo ON r.id = eo.recipient_id
      WHERE r.campaign_id = $1 AND r.user_id = $2 AND r.email IS NOT NULL
      ORDER BY r.email
    `, [campaignId, user_id]);

    res.json({
      success: true,
      data: recipientsResult.rows
    });
  } catch (error) {
    console.error('Error fetching recipient analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recipient analytics',
      error: error.message
    });
  }
});
// Get campaign by ID with comprehensive analytics
router.get('/:id', async (req, res) => {
  try {
    const campaignId = req.params.id;
    const user_id = req.user_id;
    const analytics = await getCampaignAnalytics(campaignId, user_id);
    
    if (!analytics) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch campaign',
      error: error.message
    });
  }
});

// Get detailed analytics for a campaign
router.get('/:id/analytics', async (req, res) => {
  try {
    const campaignId = req.params.id;
    const user_id = req.user_id;
    const campaign = await Campaign.findById(campaignId, user_id);
    
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    const [
      basicStats,
      openStats,
      openTrends
    ] = await Promise.all([
      getCampaignAnalytics(campaignId, user_id),
      EmailOpen.getCampaignOpenStats(campaignId, user_id),
      EmailOpen.getOpenTrends(campaignId, user_id, 30)
    ]);

    res.json({
      success: true,
      data: {
        campaign: basicStats,
        opens: openStats,
        trends: {
          opens: openTrends
        }
      }
    });
  } catch (error) {
    console.error('Error fetching campaign analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch campaign analytics',
      error: error.message
    });
  }
});

// Combined endpoint: Create campaign with recipients and send
router.post('/send-campaign', upload.single('recipients'), async (req, res) => {
  let tempFilePath = null;
  
  try {
    const { name, subject, body } = req.body;
    const user_id = req.user_id;

    // Validate required fields
    if (!name || !subject || !body) {
      return res.status(400).json({
        success: false,
        message: 'Campaign name, subject, and body are required'
      });
    }

    // Validate CSV file
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Recipients CSV file is required'
      });
    }

    tempFilePath = req.file.path;
    const recipients = [];

    // Parse CSV file
    await new Promise((resolve, reject) => {
      fs.createReadStream(tempFilePath)
        .pipe(csv())
        .on('data', (row) => {
          if (row.email && row.email.trim()) {
            recipients.push({
              email: row.email.trim(),
              name: row.name ? row.name.trim() : ''
            });
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // Clean up temp file
    fs.unlinkSync(tempFilePath);
    tempFilePath = null;

    // Validate recipients
    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid recipients found in CSV file. Please ensure your CSV has an "email" column.'
      });
    }

    // Create campaign (only after successful CSV parsing)
    const campaign = await Campaign.create({ 
      name, 
      subject, 
      body,
      total_recipients: recipients.length,
      status: 'active' // Set to active immediately since we're sending
    }, user_id);

    // Add campaign ID to recipients
    const recipientsWithCampaignId = recipients.map(recipient => ({
      ...recipient,
      campaignId: campaign.id
    }));

    // Create recipients and get their IDs
    const createdRecipients = await Recipient.createMany(recipientsWithCampaignId, user_id);

    // Create email jobs for queue using the created recipients with IDs
    const jobs = createdRecipients.map(recipient => {
      const emailContent = emailTrackingService.generateEmailTemplate(campaign, recipient);
      
      return {
        name: 'send-email',
        data: {
          campaignId: campaign.id,
          recipientId: recipient.id,
          userId: user_id,
          to: recipient.email,
          name: recipient.name,
          subject: emailContent.subject,
          body: emailContent.html
        },
        opts: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        }
      };
    });

    // Add jobs to email queue
    await emailQueue.addBulk(jobs);

    res.status(201).json({
      success: true,
      message: 'Campaign created and started successfully',
      data: {
        campaignId: campaign.id,
        campaignName: campaign.name,
        totalRecipients: recipients.length,
        status: 'active'
      }
    });

  } catch (error) {
    console.error('Error creating and sending campaign:', error);
    
    // Clean up temp file if it exists
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create and send campaign',
      error: error.message
    });
  }
});

// Optional: Draft campaign endpoint (if you want to save drafts)
router.post('/draft', async (req, res) => {
  try {
    const { name, subject, body } = req.body;
    const user_id = req.user_id;

    if (!name || !subject || !body) {
      return res.status(400).json({
        success: false,
        message: 'Name, subject, and body are required'
      });
    }

    const campaign = await Campaign.create({ 
      name, 
      subject, 
      body,
      status: 'draft'
    }, user_id);
    
    res.status(201).json({
      success: true,
      data: campaign,
      message: 'Draft campaign saved successfully'
    });
  } catch (error) {
    console.error('Error creating draft campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create draft campaign',
      error: error.message
    });
  }
});
// Send campaign with tracking
router.post('/:id/send', async (req, res) => {
  try {
    const campaignId = req.params.id;
    const user_id = req.user_id;
    const campaign = await Campaign.findById(campaignId, user_id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    if (campaign.status === 'active') {
      return res.status(400).json({
        success: false,
        message: 'Campaign is already active'
      });
    }

    const recipients = await Recipient.findByCampaignId(campaignId, user_id);

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No recipients found for this campaign'
      });
    }

    await Campaign.updateStatus(campaignId, 'active', user_id);

    const jobs = recipients.map(recipient => {
      const emailContent = emailTrackingService.generateEmailTemplate(campaign, recipient);
      
      return {
        name: 'send-email',
        data: {
          campaignId: campaign.id,
          recipientId: recipient.id,
          userId: user_id,
          to: recipient.email,
          name: recipient.name,
          subject: emailContent.subject,
          body: emailContent.html
        },
        opts: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        }
      };
    });

    await emailQueue.addBulk(jobs);

    res.json({
      success: true,
      message: 'Campaign started successfully',
      data: {
        campaignId: campaign.id,
        totalRecipients: recipients.length,
        status: 'active'
      }
    });
  } catch (error) {
    console.error('Error sending campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send campaign',
      error: error.message
    });
  }
});

// Get campaign recipients
router.get('/:id/recipients', async (req, res) => {
  try {
    const campaignId = req.params.id;
    const user_id = req.user_id;
    const recipients = await Recipient.findByCampaignId(campaignId, user_id);

    res.json({
      success: true,
      data: recipients
    });
  } catch (error) {
    console.error('Error fetching recipients:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recipients',
      error: error.message
    });
  }
});

// Delete campaign and all associated tracking data
router.delete('/:id', async (req, res) => {
  try {
    const campaignId = req.params.id;
    const user_id = req.user_id;
    const campaign = await Campaign.findById(campaignId, user_id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    await Campaign.delete(campaignId, user_id);

    res.json({
      success: true,
      message: 'Campaign and all tracking data deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete campaign',
      error: error.message
    });
  }
});

// Pause campaign
router.post('/:id/pause', async (req, res) => {
  try {
    const campaignId = req.params.id;
    const user_id = req.user_id;
    const campaign = await Campaign.findById(campaignId, user_id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    await Campaign.updateStatus(campaignId, 'paused', user_id);

    res.json({
      success: true,
      message: 'Campaign paused successfully'
    });
  } catch (error) {
    console.error('Error pausing campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to pause campaign',
      error: error.message
    });
  }
});

module.exports = router;