import type { User, Vehicle } from "@shared/schema";
import { Resend } from 'resend';
import { storage } from "./storage";

interface PersonalizationData {
  customerName: string;
  accountNumber?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  [key: string]: any;
}

async function getCredentials() {
  // First, try to get credentials from database settings
  try {
    const dbSettings = await storage.getEmailSettings();
    if (dbSettings?.resendApiKey && dbSettings?.fromEmail) {
      return {
        apiKey: dbSettings.resendApiKey,
        fromEmail: dbSettings.fromEmail
      };
    }
  } catch (error) {
    console.log('Database email settings not found, falling back to Replit integration');
  }

  // Fall back to Replit integration
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('Email not configured - no database settings or Replit integration found');
  }

  const connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || (!connectionSettings.settings.api_key)) {
    throw new Error('Resend not connected');
  }
  
  return {
    apiKey: connectionSettings.settings.api_key, 
    fromEmail: connectionSettings.settings.from_email
  };
}

/**
 * Get a fresh Resend client with current credentials
 * WARNING: Never cache this client. Access tokens expire, so a new client must be created each time.
 */
async function getResendClient() {
  const { apiKey, fromEmail } = await getCredentials();
  return {
    client: new Resend(apiKey),
    fromEmail: fromEmail
  };
}

/**
 * Personalize email content by replacing tokens like {{customerName}} with actual values
 */
export function personalizeContent(
  template: string,
  data: PersonalizationData
): string {
  let personalized = template;
  
  // Replace all {{token}} patterns with corresponding data
  Object.entries(data).forEach(([key, value]) => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    personalized = personalized.replace(regex, String(value || ''));
  });
  
  return personalized;
}

/**
 * Build personalization data from customer and vehicle information
 */
export function buildPersonalizationData(
  customer: User,
  vehicle?: Vehicle
): PersonalizationData {
  return {
    customerName: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Valued Customer',
    accountNumber: customer.accountNumber || '',
    firstName: customer.firstName || '',
    lastName: customer.lastName || '',
    email: customer.email || '',
    phone: customer.phone || '',
    vehicleMake: vehicle?.make || '',
    vehicleModel: vehicle?.model || '',
    vehicleYear: vehicle?.year || undefined,
    vehicleName: vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : '',
  };
}

/**
 * Get the appropriate email addresses for sending invoices to a customer
 * Returns both the primary recipient and CC recipients based on billing preferences
 */
export function getInvoiceEmailRecipients(customer: User): {
  to: string;
  cc?: string[];
} {
  // Use billing email if set, otherwise use login email
  const primaryEmail = customer.billingEmail || customer.email;
  
  if (!primaryEmail) {
    throw new Error('Customer has no email address configured');
  }

  const result: { to: string; cc?: string[] } = {
    to: primaryEmail
  };

  // For business customers, add CC email if configured
  if (customer.customerType === 'business' && customer.ccEmail) {
    result.cc = [customer.ccEmail];
  }

  return result;
}

/**
 * Send email via Resend API
 * Note: Requires Resend connection to be set up
 */
export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  plainText?: string;
  cc?: string[];
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
  }>;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const { client, fromEmail } = await getResendClient();

    const { data, error } = await client.emails.send({
      from: fromEmail,
      to: params.to,
      cc: params.cc,
      subject: params.subject,
      html: params.html,
      text: params.plainText,
      attachments: params.attachments,
    });

    if (error) {
      console.error('Resend API error:', error);
      return {
        success: false,
        error: `Failed to send email: ${error.message}`,
      };
    }

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (error) {
    console.error('Email sending error:', error);

    // Check if it's a connection error
    if (error instanceof Error && error.message.includes('not connected')) {
      return {
        success: false,
        error: 'Email service not configured. Please set up Resend connection in settings.',
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send personalized email campaign to a single recipient
 */
export async function sendCampaignEmail(params: {
  to: string;
  subject: string;
  htmlTemplate: string;
  plainTextTemplate?: string;
  personalizationData: PersonalizationData;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const html = personalizeContent(params.htmlTemplate, params.personalizationData);
  const plainText = params.plainTextTemplate
    ? personalizeContent(params.plainTextTemplate, params.personalizationData)
    : undefined;

  return sendEmail({
    to: params.to,
    subject: personalizeContent(params.subject, params.personalizationData),
    html,
    plainText,
  });
}

/**
 * Get available personalization tokens
 */
export function getAvailableTokens(): Array<{ token: string; description: string }> {
  return [
    { token: '{{customerName}}', description: 'Full customer name' },
    { token: '{{firstName}}', description: 'Customer first name' },
    { token: '{{lastName}}', description: 'Customer last name' },
    { token: '{{accountNumber}}', description: 'Customer account number (316-xxxx)' },
    { token: '{{email}}', description: 'Customer email address' },
    { token: '{{phone}}', description: 'Customer phone number' },
    { token: '{{vehicleMake}}', description: 'Vehicle make (e.g., Toyota)' },
    { token: '{{vehicleModel}}', description: 'Vehicle model (e.g., Camry)' },
    { token: '{{vehicleYear}}', description: 'Vehicle year' },
    { token: '{{vehicleName}}', description: 'Full vehicle name (e.g., 2020 Toyota Camry)' },
  ];
}

/**
 * Send invoice email with PDF attachment
 */
export async function sendInvoiceEmail(params: {
  customer: User;
  invoiceNumber: string;
  invoiceTotal: string;
  dueDate: string;
  pdfBuffer: Buffer;
  businessName: string;
  currencySymbol?: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    // Get recipient emails (primary + CC if business customer)
    const recipients = getInvoiceEmailRecipients(params.customer);

    const customerName = `${params.customer.firstName || ''} ${params.customer.lastName || ''}`.trim() || 'Valued Customer';
    const currency = params.currencySymbol || '$';

    // Create email HTML
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .content { margin-bottom: 20px; }
    .invoice-details { background-color: #e9ecef; padding: 15px; border-radius: 6px; margin: 20px 0; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; font-size: 12px; color: #6c757d; }
    .button { display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="header">
    <h2 style="margin: 0; color: #212529;">Invoice from ${params.businessName}</h2>
  </div>

  <div class="content">
    <p>Dear ${customerName},</p>

    <p>Thank you for your business! Please find your invoice attached to this email.</p>

    <div class="invoice-details">
      <strong>Invoice Number:</strong> ${params.invoiceNumber}<br>
      <strong>Total Amount:</strong> ${currency}${params.invoiceTotal}<br>
      <strong>Due Date:</strong> ${params.dueDate}
    </div>

    <p>The invoice is attached as a PDF file. You can view, download, and print it for your records.</p>

    <p>If you have any questions about this invoice, please don't hesitate to contact us.</p>
  </div>

  <div class="footer">
    <p>This is an automated message from ${params.businessName}. Please do not reply directly to this email.</p>
  </div>
</body>
</html>
    `.trim();

    // Create plain text version
    const plainText = `
Invoice from ${params.businessName}

Dear ${customerName},

Thank you for your business! Please find your invoice attached to this email.

Invoice Number: ${params.invoiceNumber}
Total Amount: ${currency}${params.invoiceTotal}
Due Date: ${params.dueDate}

The invoice is attached as a PDF file. You can view, download, and print it for your records.

If you have any questions about this invoice, please don't hesitate to contact us.

---
This is an automated message from ${params.businessName}. Please do not reply directly to this email.
    `.trim();

    // Send email with PDF attachment
    return sendEmail({
      to: recipients.to,
      cc: recipients.cc,
      subject: `Invoice ${params.invoiceNumber} from ${params.businessName}`,
      html,
      plainText,
      attachments: [
        {
          filename: `Invoice_${params.invoiceNumber}.pdf`,
          content: params.pdfBuffer,
        },
      ],
    });
  } catch (error) {
    console.error('Error sending invoice email:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if Resend connection is configured
 */
export async function checkEmailConnection(): Promise<{ connected: boolean; fromEmail?: string; error?: string }> {
  try {
    const { fromEmail } = await getCredentials();
    return {
      connected: true,
      fromEmail: fromEmail
    };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
