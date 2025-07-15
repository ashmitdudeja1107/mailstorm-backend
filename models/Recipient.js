const { pool } = require('../config/database');
class Recipient {
  // Updated create method to include user_id
  static async create(recipientData, userId) {
    const { campaignId, email, name } = recipientData;
    
    // First verify that the campaign belongs to the user
    const campaignCheck = await pool.query(
      'SELECT id FROM campaigns WHERE id = $1 AND user_id = $2',
      [campaignId, userId]
    );
    
    if (campaignCheck.rows.length === 0) {
      throw new Error('Campaign not found or access denied');
    }
    
    const query = `
      INSERT INTO recipients (campaign_id, user_id, email, name)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const values = [campaignId, userId, email, name];
    
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  // Updated createMany method to include user_id
  static async createMany(recipients, userId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Verify all campaigns belong to the user
      const campaignIds = [...new Set(recipients.map(r => r.campaignId))];
      const campaignCheck = await client.query(
        'SELECT id FROM campaigns WHERE id = ANY($1) AND user_id = $2',
        [campaignIds, userId]
      );
      
      if (campaignCheck.rows.length !== campaignIds.length) {
        throw new Error('Some campaigns not found or access denied');
      }
      
      const insertPromises = recipients.map(recipient => {
        const query = `
          INSERT INTO recipients (campaign_id, user_id, email, name)
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `;
        const values = [recipient.campaignId, userId, recipient.email, recipient.name];
        return client.query(query, values);
      });
      
      const results = await Promise.all(insertPromises);
      await client.query('COMMIT');
      
      return results.map(result => result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Updated to include user authentication
  static async findByCampaignId(campaignId, userId) {
    const query = `
      SELECT r.* FROM recipients r
      JOIN campaigns c ON r.campaign_id = c.id
      WHERE r.campaign_id = $1 AND c.user_id = $2
      ORDER BY r.created_at
    `;
    const result = await pool.query(query, [campaignId, userId]);
    return result.rows;
  }

  // Updated to include user authentication
  static async findById(id, userId) {
    const query = `
      SELECT r.* FROM recipients r
      JOIN campaigns c ON r.campaign_id = c.id
      WHERE r.id = $1 AND c.user_id = $2
    `;
    const result = await pool.query(query, [id, userId]);
    return result.rows[0];
  }
 static async findByUserId(userId) {
    const query = `
      SELECT DISTINCT r.* FROM recipients r
      JOIN campaigns c ON r.campaign_id = c.id
      WHERE c.user_id = $1
      ORDER BY r.created_at DESC
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
  }
  // Updated to include user authentication
  static async updateStatus(id, status, userId, errorMessage = null) {
    const query = `
      UPDATE recipients 
      SET status = $1, sent_at = CURRENT_TIMESTAMP, error_message = $2
      FROM campaigns c
      WHERE recipients.id = $3 AND recipients.campaign_id = c.id AND c.user_id = $4
      RETURNING recipients.*
    `;
    const result = await pool.query(query, [status, errorMessage, id, userId]);
    return result.rows[0];
  }

  // Updated to include user authentication
  static async getPendingByCampaignId(campaignId, userId) {
    const query = `
      SELECT r.* FROM recipients r
      JOIN campaigns c ON r.campaign_id = c.id
      WHERE r.campaign_id = $1 AND r.status = 'pending' AND c.user_id = $2
    `;
    const result = await pool.query(query, [campaignId, userId]);
    return result.rows;
  }

  // Updated to include user authentication
  static async getStatusCounts(campaignId, userId) {
    const query = `
      SELECT 
        r.status,
        COUNT(*) as count
      FROM recipients r
      JOIN campaigns c ON r.campaign_id = c.id
      WHERE r.campaign_id = $1 AND c.user_id = $2
      GROUP BY r.status
    `;
    const result = await pool.query(query, [campaignId, userId]);
    return result.rows;
  }

  // Updated to include user authentication
  static async delete(id, userId) {
    const query = `
      DELETE FROM recipients
      USING campaigns c
      WHERE recipients.id = $1 AND recipients.campaign_id = c.id AND c.user_id = $2
      RETURNING recipients.*
    `;
    const result = await pool.query(query, [id, userId]);
    return result.rows[0];
  }

  // Updated to include user authentication
  static async deleteByCampaignId(campaignId, userId) {
    const query = `
      DELETE FROM recipients
      USING campaigns c
      WHERE recipients.campaign_id = $1 AND recipients.campaign_id = c.id AND c.user_id = $2
      RETURNING recipients.*
    `;
    const result = await pool.query(query, [campaignId, userId]);
    return result.rows;
  }

  static async findByIdPublic(id) {
    try {
      const query = 'SELECT * FROM recipients WHERE id = $1';
      const result = await pool.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error finding recipient:', error);
      throw error;
    }
  }
}

module.exports = Recipient;