const crypto = require('crypto');

class EmailTrackingService {
  constructor(baseUrl) {
    this.baseUrl = baseUrl || process.env.APP_BASE_URL || 'https://mailstorm-backend-1.onrender.com';
  }

  // Generate tracking pixel HTML for email opens
  generateTrackingPixel(campaignId, recipientId) {
    const trackingUrl = `${this.baseUrl}/api/opens/track/${campaignId}/${recipientId}`;
    return `<img src="${trackingUrl}" width="1" height="1" style="display:none;" alt="">`;
  }

  // Process email content to add open tracking
  processEmailContent(emailBody, campaignId, recipientId) {
    // Add tracking pixel at the end of the email
    const trackingPixel = this.generateTrackingPixel(campaignId, recipientId);
    return emailBody + trackingPixel;
  }

  // Generate simple unsubscribe link (no token)
  generateUnsubscribeLink(campaignId, recipientId) {
    return `${this.baseUrl}/api/unsubscribe/${campaignId}/${recipientId}`;
  }

  // Generate VIEW tracking URL (different from open tracking)
  generateViewTrackingUrl(campaignId, recipientId) {
    return `${this.baseUrl}/api/campaigns/${campaignId}/view/${recipientId}`;
  }

  // Generate preview message with view button
  generatePreviewMessage(fullContent, campaignId, recipientId, subject) {
    const viewFullUrl = `${this.baseUrl}/api/campaigns/${campaignId}/view/${recipientId}`;
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            line-height: 1.6; 
            margin: 0; 
            padding: 20px; 
            background-color: #f4f4f4; 
          }
          .preview-container { 
            max-width: 600px; 
            margin: 0 auto; 
            background: white; 
            border-radius: 12px; 
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          }
          .preview-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            text-align: center;
          }
          .preview-content {
            padding: 30px;
            text-align: center;
          }
          .email-icon {
            font-size: 48px;
            margin-bottom: 20px;
          }
          .view-button {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 15px 30px;
            text-decoration: none;
            border-radius: 50px;
            font-weight: bold;
            font-size: 16px;
            margin: 20px 0;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
            transition: all 0.3s ease;
          }
          .view-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
          }
          .preview-text {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
            border-left: 4px solid #28a745;
          }
          .footer {
            text-align: center;
            padding: 20px;
            background: #f8f9fa;
            font-size: 12px;
            color: #666;
          }
        </style>
      </head>
      <body>
        <div class="preview-container">
          <div class="preview-header">
            <h1 style="margin: 0; font-size: 24px;">📧 You've Got Mail!</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">New message waiting for you</p>
          </div>
          
          <div class="preview-content">
            <div class="email-icon">📬</div>
            <h2 style="color: #333; margin-bottom: 15px;">${subject}</h2>
            <p style="color: #666; font-size: 16px; margin-bottom: 25px;">
              You have received a new message. Click the button below to view the full content.
            </p>
            
            <a href="${viewFullUrl}" class="view-button">
              📖 View Full Message
            </a>
            
            <div class="preview-text">
              <h4 style="color: #333; margin-bottom: 10px;">📝 Preview:</h4>
              <p style="color: #666; font-style: italic; margin: 0;">
                ${this.generateContentPreview(fullContent)}
              </p>
            </div>
          </div>
          
          <div class="footer">
            <p style="margin: 0;">This is an automated message preview.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Generate a brief preview of the email content
  generateContentPreview(fullContent, maxLength = 150) {
    // Remove HTML tags and get plain text
    const plainText = fullContent.replace(/<[^>]*>/g, '').trim();
    
    // Truncate if too long
    if (plainText.length > maxLength) {
      return plainText.substring(0, maxLength) + '...';
    }
    
    return plainText;
  }

  // Generate the full email view page
  generateFullEmailView(campaign, recipient) {
    const { id: campaignId, subject, body } = campaign;
    const { id: recipientId, email, name } = recipient;

    // Personalize email content
    let personalizedBody = body;
    if (name) {
      personalizedBody = personalizedBody.replace(/\{\{name\}\}/g, name);
    }
    personalizedBody = personalizedBody.replace(/\{\{email\}\}/g, email);

    // Add tracking to the email body
    const trackedBody = this.processEmailContent(personalizedBody, campaignId, recipientId);

    // Generate unsubscribe link
    const unsubscribeLink = this.generateUnsubscribeLink(campaignId, recipientId);

    // Add unsubscribe link to email footer
    const emailFooter = `
      <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
      <p style="font-size: 12px; color: #666; text-align: center;">
        If you no longer wish to receive these emails, you can 
        <a href="${unsubscribeLink}" style="color: #666;">unsubscribe here</a>.
      </p>
    `;

    const fullContent = trackedBody + emailFooter;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            line-height: 1.6; 
            margin: 0; 
            padding: 20px; 
            background-color: #f4f4f4; 
          }
          .email-container { 
            max-width: 600px; 
            margin: 0 auto; 
            background: white; 
            padding: 20px; 
            border-radius: 8px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
          }
          .header { 
            text-align: center; 
            margin-bottom: 20px; 
            padding-bottom: 15px; 
            border-bottom: 2px solid #e8f4fd; 
          }
          .back-link { 
            display: inline-block; 
            margin-bottom: 15px; 
            color: #0066cc; 
            text-decoration: none; 
          }
          .back-link:hover { 
            text-decoration: underline; 
          }
          .email-content {
            background: #f9f9f9;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <h1 style="color: #0066cc; margin: 0;">${subject}</h1>
            <p style="color: #666; margin: 5px 0 0 0;">
              ${name ? `To: ${name} (${email})` : `To: ${email}`}
            </p>
          </div>
          
          <div class="email-content">
            ${fullContent}
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Generate email template with tracking and preview
  generateEmailTemplate(campaign, recipient) {
    const { id: campaignId, subject, body } = campaign;
    const { id: recipientId, email, name } = recipient;

    // Personalize email content
    let personalizedBody = body;
    if (name) {
      personalizedBody = personalizedBody.replace(/\{\{name\}\}/g, name);
    }
    personalizedBody = personalizedBody.replace(/\{\{email\}\}/g, email);

    // Add tracking to the email body
    const trackedBody = this.processEmailContent(personalizedBody, campaignId, recipientId);

    // Generate unsubscribe link
    const unsubscribeLink = this.generateUnsubscribeLink(campaignId, recipientId);

    // Add unsubscribe link to email footer
    const emailFooter = `
      <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
      <p style="font-size: 12px; color: #666; text-align: center;">
        If you no longer wish to receive these emails, you can 
        <a href="${unsubscribeLink}" style="color: #666;">unsubscribe here</a>.
      </p>
    `;

    const fullContent = trackedBody + emailFooter;
    const previewMessage = this.generatePreviewMessage(fullContent, campaignId, recipientId, subject);

    return {
      to: email,
      subject: subject,
      html: previewMessage, // Send preview with view button
      fullContent: fullContent, // Store full content for the view page
      campaignId: campaignId,
      recipientId: recipientId
    };
  }
}

module.exports = EmailTrackingService;