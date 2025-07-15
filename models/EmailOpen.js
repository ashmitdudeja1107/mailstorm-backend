const { pool } = require('../config/database');



class EmailOpen {
  // Create email open tracking record with user authentication
  static async create(data) {
    const { campaignId, recipientId, userId, userAgent, ipAddress } = data;
    
    const query = `
      INSERT INTO email_opens (
        campaign_id, 
        recipient_id, 
        user_id,
        user_agent, 
        ip_address, 
        action_type,
        opened_at
      )
      VALUES ($1, $2, $3, $4, $5, 'open', CURRENT_TIMESTAMP)
      RETURNING *
    `;
    const params = [campaignId, recipientId, userId, userAgent, ipAddress];
    
    const result = await pool.query(query, params);
    return result.rows[0];
  }

  // Get all opens for a campaign (filtered by user)
  static async findByCampaignId(campaignId, userId) {
    const query = `
      SELECT 
        eo.*,
        r.email,
        r.name,
        c.name as campaign_name
      FROM email_opens eo
      JOIN recipients r ON eo.recipient_id = r.id
      JOIN campaigns c ON eo.campaign_id = c.id
      WHERE eo.campaign_id = $1 AND eo.user_id = $2
      ORDER BY eo.opened_at DESC
    `;
    
    const result = await pool.query(query, [campaignId, userId]);
    return result.rows;
  }

  // Get opens for a specific recipient (filtered by user)
  static async findByRecipientId(recipientId, userId) {
    const query = `
      SELECT * FROM email_opens 
      WHERE recipient_id = $1 AND user_id = $2
      ORDER BY opened_at DESC
    `;
    
    const result = await pool.query(query, [recipientId, userId]);
    return result.rows;
  }

 static async getCampaignOpenStats(campaignId, userId) {
    const query = `
      SELECT 
        COUNT(DISTINCT eo.recipient_id) as unique_opens,
        COUNT(eo.id) as total_opens,
        (SELECT COUNT(*) FROM recipients WHERE campaign_id = $1 AND user_id = $2) as total_recipients,
        CASE 
          WHEN (SELECT COUNT(*) FROM recipients WHERE campaign_id = $1 AND user_id = $2) = 0 THEN 0
          ELSE ROUND(
            (COUNT(DISTINCT eo.recipient_id)::numeric / 
             (SELECT COUNT(*) FROM recipients WHERE campaign_id = $1 AND user_id = $2)) * 100, 2
          )
        END as open_rate
      FROM email_opens eo
      WHERE eo.campaign_id = $1 AND eo.user_id = $2
    `;
    
    const result = await pool.query(query, [campaignId, userId]);
    return result.rows[0];
  }
  // Check if recipient has already opened email (filtered by user)
  static async hasRecipientOpened(campaignId, recipientId, userId) {
  const query = `
    SELECT COUNT(*) as count 
    FROM email_opens 
    WHERE campaign_id = $1 AND recipient_id = $2 AND user_id = $3
  `;
  
  const result = await pool.query(query, [campaignId, recipientId, userId]);
  return parseInt(result.rows[0].count) > 0;
}
  // Get recent opens with pagination (filtered by user)
  static async getRecentOpens(userId, limit = 50, offset = 0) {
    const query = `
      SELECT 
        eo.*,
        r.email,
        r.name,
        c.name as campaign_name
      FROM email_opens eo
      JOIN recipients r ON eo.recipient_id = r.id
      JOIN campaigns c ON eo.campaign_id = c.id
      WHERE eo.user_id = $1
      ORDER BY eo.opened_at DESC
      LIMIT $2 OFFSET $3
    `;
    
    const result = await pool.query(query, [userId, limit, offset]);
    return result.rows;
  }

  // Get open trends by date (filtered by user)
static async getOpenTrends(campaignId, userId, days = 7) {
  const query = `
    SELECT 
      DATE(opened_at) as date,
      COUNT(DISTINCT recipient_id) as unique_opens,
      COUNT(id) as total_opens
    FROM email_opens
    WHERE campaign_id = $1 AND user_id = $2
      AND opened_at >= CURRENT_DATE - INTERVAL $3 || ' days'
    GROUP BY DATE(opened_at)
    ORDER BY date DESC
  `;
  
  const result = await pool.query(query, [campaignId, userId, days]);
  return result.rows;
}

  // Get campaign stats (filtered by user)
  static async getCampaignStats(campaignId, userId) {
    const query = `
      SELECT 
        (SELECT COUNT(*) FROM recipients WHERE campaign_id = $1 AND user_id = $2) as total_recipients,
        COUNT(DISTINCT recipient_id) as unique_opens,
        COUNT(id) as total_opens,
        ROUND(
          (COUNT(DISTINCT recipient_id)::float / 
           NULLIF((SELECT COUNT(*) FROM recipients WHERE campaign_id = $1 AND user_id = $2), 0)) * 100, 2
        ) as open_rate
      FROM email_opens
      WHERE campaign_id = $1 AND user_id = $2
    `;
    
    const result = await pool.query(query, [campaignId, userId]);
    return result.rows[0];
  }

  // Delete opens for a campaign (filtered by user)
  static async deleteByCampaignId(campaignId, userId) {
    const query = 'DELETE FROM email_opens WHERE campaign_id = $1 AND user_id = $2';
    const result = await pool.query(query, [campaignId, userId]);
    return result.rowCount;
  }

  // Get all opens for a user (across all campaigns)
  static async findByUserId(userId, limit = 100, offset = 0) {
    const query = `
      SELECT 
        eo.*,
        r.email,
        r.name,
        c.name as campaign_name
      FROM email_opens eo
      JOIN recipients r ON eo.recipient_id = r.id
      JOIN campaigns c ON eo.campaign_id = c.id
      WHERE eo.user_id = $1
      ORDER BY eo.opened_at DESC
      LIMIT $2 OFFSET $3
    `;
    
    const result = await pool.query(query, [userId, limit, offset]);
    return result.rows;
  }

  // Get user's overall email open statistics
  static async getUserOpenStats(userId) {
    const query = `
      SELECT 
        COUNT(DISTINCT eo.campaign_id) as total_campaigns,
        COUNT(DISTINCT eo.recipient_id) as unique_opens,
        COUNT(eo.id) as total_opens,
        (SELECT COUNT(*) FROM recipients WHERE user_id = $1) as total_recipients,
        ROUND(
          (COUNT(DISTINCT eo.recipient_id)::float / 
           NULLIF((SELECT COUNT(*) FROM recipients WHERE user_id = $1), 0)) * 100, 2
        ) as overall_open_rate
      FROM email_opens eo
      WHERE eo.user_id = $1
    `;
    
    const result = await pool.query(query, [userId]);
    return result.rows[0];
  }

  // Validate user ownership of email open record
  static async validateUserOwnership(openId, userId) {
    const query = `
      SELECT COUNT(*) as count 
      FROM email_opens 
      WHERE id = $1 AND user_id = $2
    `;
    
    const result = await pool.query(query, [openId, userId]);
    return parseInt(result.rows[0].count) > 0;
  }
  static async createPublic(data) {
    try {
      const query = `
        INSERT INTO email_opens (campaign_id, recipient_id, user_id, opened_at)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `;
      const values = [data.campaignId, data.recipientId, data.userId, data.openedAt];
      
      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating email open record:', error);
      throw error;
    }
  }
}

module.exports = EmailOpen;