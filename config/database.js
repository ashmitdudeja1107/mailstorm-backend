const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: {
    rejectUnauthorized: false,
    ca: ""   // ✅ OVERRIDES the cert chain completely
  }
});

// Initialize database tables with user authentication
const initDB = async () => {
  try {
    // STEP 1: Create users table first (since other tables reference it)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(100) NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        isdeleted BOOLEAN DEFAULT false,
        manual_check BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // STEP 2: Create all other tables with user_id columns included
    await pool.query(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'draft',
        total_recipients INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS recipients (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending',
        sent_at TIMESTAMP,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_opens (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
        recipient_id INTEGER REFERENCES recipients(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        user_agent TEXT,
        ip_address INET,
        opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // STEP 3: Add new columns if they don't exist (for existing databases)
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name = 'users' AND column_name = 'manual_check') THEN
          ALTER TABLE users ADD COLUMN manual_check BOOLEAN DEFAULT false;
        END IF;
      END $$;
    `);

    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name = 'users' AND column_name = 'created_at') THEN
          ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        END IF;
      END $$;
    `);

    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name = 'users' AND column_name = 'updated_at') THEN
          ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        END IF;
      END $$;
    `);

    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name = 'campaigns' AND column_name = 'user_id') THEN
          ALTER TABLE campaigns ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name = 'recipients' AND column_name = 'user_id') THEN
          ALTER TABLE recipients ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name = 'email_opens' AND column_name = 'user_id') THEN
          ALTER TABLE email_opens ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    // STEP 4: Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
      CREATE INDEX IF NOT EXISTS idx_users_manual_check ON users(manual_check);
      CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
      CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
      CREATE INDEX IF NOT EXISTS idx_recipients_campaign_id ON recipients(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_recipients_user_id ON recipients(user_id);
      CREATE INDEX IF NOT EXISTS idx_recipients_status ON recipients(status);
      CREATE INDEX IF NOT EXISTS idx_email_opens_campaign_id ON email_opens(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_email_opens_recipient_id ON email_opens(recipient_id);
      CREATE INDEX IF NOT EXISTS idx_email_opens_user_id ON email_opens(user_id);
      CREATE INDEX IF NOT EXISTS idx_email_opens_opened_at ON email_opens(opened_at);
    `);

    // STEP 5: Create trigger function to update updated_at timestamp
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);

    // STEP 6: Create triggers for updated_at columns
    await pool.query(`
      DROP TRIGGER IF EXISTS update_users_updated_at ON users;
      CREATE TRIGGER update_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS update_campaigns_updated_at ON campaigns;
      CREATE TRIGGER update_campaigns_updated_at
        BEFORE UPDATE ON campaigns
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    `);

    console.log('Database initialized successfully with user authentication and manual check');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
};

// Get comprehensive campaign analytics
const getCampaignAnalytics = async (campaignId, userId) => {
  try {
    const query = `
      SELECT 
        c.id,
        c.name,
        c.subject,
        c.body,
        c.status,
        c.total_recipients,
        c.created_at,
        c.updated_at,
        
        -- Basic recipient stats
        COUNT(DISTINCT r.id) as actual_recipients,
        COUNT(DISTINCT CASE WHEN r.status = 'sent' THEN r.id END) as sent_count,
        COUNT(DISTINCT CASE WHEN r.status = 'failed' THEN r.id END) as failed_count,
        COUNT(DISTINCT CASE WHEN r.status = 'pending' THEN r.id END) as pending_count,
        
        -- Email open stats (fixed the join condition)
        COUNT(DISTINCT eo.recipient_id) as unique_opens,
        COUNT(eo.id) as total_opens,
        
        -- Calculate open rate
        CASE 
          WHEN COUNT(DISTINCT CASE WHEN r.status = 'sent' THEN r.id END) > 0 
          THEN ROUND(
            (COUNT(DISTINCT eo.recipient_id)::decimal / COUNT(DISTINCT CASE WHEN r.status = 'sent' THEN r.id END)::decimal) * 100, 
            2
          )
          ELSE 0 
        END as open_rate,
        
        -- Last activity
        MAX(eo.opened_at) as last_opened_at,
        MAX(r.sent_at) as last_sent_at
        
      FROM campaigns c
      LEFT JOIN recipients r ON c.id = r.campaign_id AND r.user_id = $2
      LEFT JOIN email_opens eo ON r.id = eo.recipient_id AND eo.campaign_id = $1 AND eo.user_id = $2
      WHERE c.id = $1 AND c.user_id = $2
      GROUP BY c.id, c.name, c.subject, c.body, c.status, c.total_recipients, c.created_at, c.updated_at
    `;

    const result = await pool.query(query, [campaignId, userId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    console.error('Error getting campaign analytics:', error);
    throw error;
  }
};

// Function to approve a user's manual check
const approveUser = async (userId) => {
  try {
    const query = `
      UPDATE users 
      SET manual_check = true, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $1
      RETURNING id, name, email, manual_check
    `;
    
    const result = await pool.query(query, [userId]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return result.rows[0];
  } catch (error) {
    console.error('Error approving user:', error);
    throw error;
  }
};

// Function to get all users pending approval
const getPendingUsers = async () => {
  try {
    const query = `
      SELECT id, name, email, created_at 
      FROM users 
      WHERE manual_check = false AND isdeleted = false
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    console.error('Error getting pending users:', error);
    throw error;
  }
};

module.exports = {
  pool,
  initDB,
  getCampaignAnalytics,
  approveUser,
  getPendingUsers
};
