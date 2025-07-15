const { pool } = require('../config/database');

class Campaign {
  // Updated create method to include user_id
  static async create(campaignData, userId) {
    const { name, subject, body } = campaignData;
    const query = `
      INSERT INTO campaigns (user_id, name, subject, body)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const values = [userId, name, subject, body];
    
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  // Updated to include user authentication
  static async findById(id, userId) {
    const query = 'SELECT * FROM campaigns WHERE id = $1 AND user_id = $2';
    const result = await pool.query(query, [id, userId]);
    return result.rows[0];
  }

  // Updated to show only user's campaigns
  static async findAll(userId) {
    const query = `
      SELECT 
        c.*,
        COUNT(r.id) as recipient_count,
        COUNT(CASE WHEN r.status = 'sent' THEN 1 END) as sent_count,
        COUNT(CASE WHEN r.status = 'failed' THEN 1 END) as failed_count
      FROM campaigns c
      LEFT JOIN recipients r ON c.id = r.campaign_id
      WHERE c.user_id = $1
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
  }

  // Updated to include user authentication
  static async updateStatus(id, status, userId) {
    const query = `
      UPDATE campaigns 
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `;
    const result = await pool.query(query, [status, id, userId]);
    return result.rows[0];
  }

  // Updated to include user authentication
  static async updateTotalRecipients(id, count, userId) {
    const query = `
      UPDATE campaigns 
      SET total_recipients = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `;
    const result = await pool.query(query, [count, id, userId]);
    return result.rows[0];
  }

  // FIXED: Updated delete method with proper cascade handling
  static async delete(id, userId) {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // First verify the campaign exists and belongs to the user
      const campaignCheck = await client.query(
        'SELECT id FROM campaigns WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
      
      if (campaignCheck.rows.length === 0) {
        throw new Error('Campaign not found or you do not have permission to delete it');
      }
      
      // Delete related records first (in case CASCADE isn't working properly)
      // Delete email_opens first (depends on recipient_id)
      await client.query(
        'DELETE FROM email_opens WHERE campaign_id = $1 AND user_id = $2',
        [id, userId]
      );
      
      // Then delete recipients
      await client.query(
        'DELETE FROM recipients WHERE campaign_id = $1 AND user_id = $2',
        [id, userId]
      );
      
      // Finally delete the campaign
      const result = await client.query(
        'DELETE FROM campaigns WHERE id = $1 AND user_id = $2 RETURNING *',
        [id, userId]
      );
      
      await client.query('COMMIT');
      return result.rows[0];
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error in Campaign.delete:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Helper method to check what records exist (for debugging)
  static async checkReferences(campaignId) {
    try {
      const references = {};
      
      // Check recipients
      const recipients = await pool.query(
        'SELECT COUNT(*) as count FROM recipients WHERE campaign_id = $1',
        [campaignId]
      );
      references.recipients = parseInt(recipients.rows[0].count);
      
      // Check email_opens
      const emailOpens = await pool.query(
        'SELECT COUNT(*) as count FROM email_opens WHERE campaign_id = $1',
        [campaignId]
      );
      references.emailOpens = parseInt(emailOpens.rows[0].count);
      
      return references;
      
    } catch (error) {
      console.error('Error checking references:', error);
      throw error;
    }
  }

  // Updated to include user authentication
  static async getCampaignStats(id, userId) {
    const query = `
      SELECT 
        c.*,
        COUNT(r.id) as total_recipients,
        COUNT(CASE WHEN r.status = 'sent' THEN 1 END) as sent_count,
        COUNT(CASE WHEN r.status = 'failed' THEN 1 END) as failed_count,
        COUNT(CASE WHEN r.status = 'pending' THEN 1 END) as pending_count,
        COUNT(DISTINCT eo.recipient_id) as unique_opens,
        COUNT(eo.id) as total_opens
      FROM campaigns c
      LEFT JOIN recipients r ON c.id = r.campaign_id
      LEFT JOIN email_opens eo ON c.id = eo.campaign_id
      WHERE c.id = $1 AND c.user_id = $2
      GROUP BY c.id
    `;
    const result = await pool.query(query, [id, userId]);
    return result.rows[0];
  }

  static async findByIdPublic(id) {
    try {
      const query = 'SELECT * FROM campaigns WHERE id = $1';
      const result = await pool.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error finding campaign:', error);
      throw error;
    }
  }
}

module.exports = Campaign;