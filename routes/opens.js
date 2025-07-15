const express = require('express');
const EmailOpen = require('../models/EmailOpen');
const Campaign = require('../models/Campaign');
const Recipient = require('../models/Recipient');
const googleAuthMiddleware = require('../middleware/googleAuthMiddleware'); // Adjust path as needed
const { pool } = require('../config/database');

const router = express.Router();

// Store recent opens in memory (for demo purposes)
let recentOpens = [];

router.get('/track/:campaignId/:recipientId', async (req, res) => {
  try {
    const { campaignId, recipientId } = req.params;
    const userAgent = req.headers['user-agent'] || '';
    const ipAddress = req.ip || req.connection.remoteAddress;

    // Get user_id from query parameters (since this is a GET request)
    const userId = req.query.user_id;
    
    if (!userId) {
      return res.status(200).send(getTrackingPixel());
    }

    // Verify campaign and recipient exist and belong to the user
    const campaign = await Campaign.findById(campaignId, userId);
    const recipient = await Recipient.findById(recipientId, userId);

    if (!campaign || !recipient) {
      return res.status(200).send(getTrackingPixel());
    }

    // Use INSERT with NOT EXISTS to prevent duplicates atomically
    const insertQuery = `
      INSERT INTO email_opens (
        campaign_id, 
        recipient_id, 
        user_id,
        user_agent, 
        ip_address, 
        action_type,
        opened_at
      )
      SELECT $1, $2, $3, $4, $5, 'open', CURRENT_TIMESTAMP
      WHERE NOT EXISTS (
        SELECT 1 FROM email_opens 
        WHERE campaign_id = $1 AND recipient_id = $2 AND user_id = $3
      )
      RETURNING *
    `;

    let isFirstOpen = false;

    try {
      const result = await pool.query(insertQuery, [
        parseInt(campaignId),
        parseInt(recipientId),
        userId,
        userAgent,
        ipAddress
      ]);

      // If a row was returned, it means this was the first open
      if (result.rows.length > 0) {
        isFirstOpen = true;
        
        // Update recipient status
        await Recipient.updateStatus(recipientId, 'opened', userId);
      }

    } catch (error) {
      // Log the error but don't throw - just continue
      console.error('Error inserting email open:', error);
    }

    // Handle notifications
    if (isFirstOpen) {
      // Store notification in memory
      const notification = {
        id: Date.now(),
        campaignId: parseInt(campaignId),
        recipientId: parseInt(recipientId),
        userId: userId,
        campaignName: campaign.name,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        isFirstOpen: true,
        timestamp: new Date(),
        userAgent,
        ipAddress,
        actionType: 'open'
      };

      // Add to recent opens (keep last 100)
      recentOpens.unshift(notification);
      if (recentOpens.length > 100) {
        recentOpens = recentOpens.slice(0, 100);
      }

      // Log the notification
      console.log('📧 EMAIL OPENED (FIRST TIME):', {
        campaign: campaign.name,
        recipient: recipient.email,
        timestamp: new Date().toISOString()
      });

      // Optional: Send webhook notification
      await sendWebhookNotification(notification);
    } else {
      // Log that this is a repeat open (but don't record it)
      console.log('📧 EMAIL OPENED (REPEAT - NOT RECORDED):', {
        campaign: campaign.name,
        recipient: recipient.email,
        timestamp: new Date().toISOString()
      });
    }

    // Return 1x1 transparent pixel regardless
    res.status(200).send(getTrackingPixel());
  } catch (error) {
    console.error('Error tracking email open:', error);
    res.status(200).send(getTrackingPixel());
  }
});

// Get opens - consolidated route that handles campaign, recipient, or all opens
// Protected with Google Auth middleware
router.get('/opens', googleAuthMiddleware, async (req, res) => {
  try {
    // Get user_id from middleware (set by googleAuthMiddleware)
    const userId = req.user_id;
    const { campaignId, recipientId, limit = 100, offset = 0, days } = req.query;
    
    console.log('=== DEBUG OPENS ROUTE ===');
    console.log('User ID:', userId);
    console.log('Campaign ID:', campaignId);
    console.log('Campaign ID type:', typeof campaignId);
    console.log('Recipient ID:', recipientId);
    console.log('Days:', days);
    
    let opens;
    let message = 'Opens retrieved successfully';
    
    if (campaignId) {
      // Convert campaignId to integer if it's a string
      const campaignIdInt = parseInt(campaignId);
      console.log('Campaign ID (parsed):', campaignIdInt);
      
      // Verify campaign exists and belongs to user
      const campaign = await Campaign.findById(campaignIdInt, userId);
      console.log('Campaign found:', !!campaign);
      
      if (!campaign) {
        console.log('Campaign not found for user:', userId, 'campaign:', campaignIdInt);
        return res.status(404).json({
          success: false,
          message: 'Campaign not found'
        });
      }
      
      if (days) {
        // Get trends for the campaign
        console.log('Getting trends for campaign:', campaignIdInt, 'days:', days);
        opens = await EmailOpen.getOpenTrends(campaignIdInt, userId, parseInt(days));
        message = 'Campaign trends retrieved successfully';
      } else {
        // Get all opens for the campaign
        console.log('Getting opens for campaign:', campaignIdInt, 'user:', userId);
        
        // Debug: Check total opens for this campaign (all users)
        const totalOpensQuery = `
          SELECT COUNT(*) as count 
          FROM email_opens 
          WHERE campaign_id = $1
        `;
        const totalOpensResult = await pool.query(totalOpensQuery, [campaignIdInt]);
        console.log('Total opens for campaign (all users):', totalOpensResult.rows[0].count);
        
        // Debug: Check opens for this campaign and user
        const userOpensQuery = `
          SELECT COUNT(*) as count 
          FROM email_opens 
          WHERE campaign_id = $1 AND user_id = $2
        `;
        const userOpensResult = await pool.query(userOpensQuery, [campaignIdInt, userId]);
        console.log('Opens for this campaign and user:', userOpensResult.rows[0].count);
        
        opens = await EmailOpen.findByCampaignId(campaignIdInt, userId);
        console.log('Opens returned:', opens.length);
        message = 'Campaign opens retrieved successfully';
      }
    } else if (recipientId) {
      // Convert recipientId to integer if it's a string
      const recipientIdInt = parseInt(recipientId);
      console.log('Recipient ID (parsed):', recipientIdInt);
      
      // Verify recipient exists and belongs to user
      const recipient = await Recipient.findById(recipientIdInt, userId);
      console.log('Recipient found:', !!recipient);
      
      if (!recipient) {
        console.log('Recipient not found for user:', userId, 'recipient:', recipientIdInt);
        return res.status(404).json({
          success: false,
          message: 'Recipient not found'
        });
      }
      
      opens = await EmailOpen.findByRecipientId(recipientIdInt, userId);
      console.log('Recipient opens returned:', opens.length);
      message = 'Recipient opens retrieved successfully';
    } else {
      // Get all opens for the user (recent opens)
      console.log('Getting recent opens for user:', userId, 'limit:', limit, 'offset:', offset);
      opens = await EmailOpen.getRecentOpens(userId, parseInt(limit), parseInt(offset));
      console.log('Recent opens returned:', opens.length);
      message = 'Recent opens retrieved successfully';
    }
    
    console.log('=== END DEBUG ===');
    
    res.json({
      success: true,
      message,
      data: opens,
      debug: {
        userId,
        campaignId: campaignId ? parseInt(campaignId) : null,
        recipientId: recipientId ? parseInt(recipientId) : null,
        totalResults: opens.length
      }
    });
  } catch (error) {
    console.error('Error fetching opens:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch opens',
      error: error.message
    });
  }
});

// Get user statistics - consolidated stats endpoint
// Protected with Google Auth middleware
router.get('/campaigns/:campaignId/stats', googleAuthMiddleware, async (req, res) => {
  try {
    const { campaignId } = req.params;
    const userId = req.user_id; // Get from middleware
    
    if (!campaignId) {
      return res.status(400).json({
        success: false,
        message: 'campaignId is required'
      });
    }
    
    const stats = await EmailOpen.getCampaignOpenStats(campaignId, userId);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching campaign stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch campaign statistics',
      error: error.message
    });
  }
});

// Clear notifications for the authenticated user
// Protected with Google Auth middleware
router.delete('/notifications', googleAuthMiddleware, async (req, res) => {
  try {
    const userId = req.user_id; // Get from middleware
    
    // Filter out notifications for this user
    recentOpens = recentOpens.filter(notification => notification.userId !== userId);
    
    res.json({
      success: true,
      message: 'Notifications cleared'
    });
  } catch (error) {
    console.error('Error clearing notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear notifications',
      error: error.message
    });
  }
});

// Get recent notifications for authenticated user
// Protected with Google Auth middleware
router.get('/notifications', googleAuthMiddleware, async (req, res) => {
  try {
    const userId = req.user_id; // Get from middleware
    const { limit = 50 } = req.query;
    
    // Filter notifications for this user
    const userNotifications = recentOpens
      .filter(notification => notification.userId === userId)
      .slice(0, parseInt(limit));
    
    res.json({
      success: true,
      message: 'Notifications retrieved successfully',
      data: userNotifications
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error.message
    });
  }
});

// Helper function to generate 1x1 transparent pixel
function getTrackingPixel() {
  const pixel = Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
    0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21,
    0xF9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2C, 0x00, 0x00,
    0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
    0x01, 0x00, 0x3B
  ]);
  
  return pixel;
}

// Helper function to send webhook notifications
async function sendWebhookNotification(data) {
  try {
    const webhookUrl = process.env.WEBHOOK_URL;
    
    if (webhookUrl) {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event: 'email.opened',
          data: data
        })
      });
      
      if (response.ok) {
        console.log('Webhook notification sent successfully');
      }
    }
  } catch (error) {
    console.error('Error sending webhook notification:', error);
  }
}

module.exports = router;