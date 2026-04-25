import { logger } from './middleware/structuredLogging';

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface TransactionEmailDetails {
  amount: string;
  asset: string;
  date: string;
  txHash: string;
  walletAddress: string;
}

/**
 * Email service for sending notifications.
 * Supports SendGrid and Resend providers.
 */
export class EmailService {
  private provider: 'sendgrid' | 'resend';
  private apiKey: string;
  private fromEmail: string;

  constructor() {
    this.provider = (process.env.EMAIL_PROVIDER as 'sendgrid' | 'resend') || 'resend';
    this.apiKey = process.env.EMAIL_API_KEY || '';
    this.fromEmail = process.env.EMAIL_FROM_ADDRESS || 'notifications@yieldvault.finance';

    if (!this.apiKey && process.env.NODE_ENV === 'production') {
      logger.log('error', 'Email API key is missing in production environment');
    }
  }

  /**
   * Send a generic email.
   * Implementation is a mock that logs in non-production environments.
   */
  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      if (process.env.NODE_ENV !== 'production' && !this.apiKey) {
        logger.log('info', `[MOCK EMAIL] Sending ${this.provider} email to ${options.to}`, {
          subject: options.subject,
          text: options.text,
        });
        return true;
      }

      if (!this.apiKey) {
        throw new Error('Email API key not configured');
      }

      // In a real implementation, we would use the provider's SDK or HTTP API here.
      // For this task, we'll simulate the call and log failures.
      
      const success = await this.simulateProviderCall(options);
      
      if (success) {
        logger.log('info', `Email sent successfully to ${options.to} via ${this.provider}`);
      } else {
        throw new Error(`Failed to send email via ${this.provider}`);
      }

      return true;
    } catch (error) {
      logger.log('error', 'Failed to send email notification', {
        error: error instanceof Error ? error.message : String(error),
        to: options.to,
        provider: this.provider,
      });
      // Return false but don't throw to avoid affecting the API response as per requirements
      return false;
    }
  }

  /**
   * Send deposit confirmation email.
   */
  async sendDepositConfirmation(to: string, details: TransactionEmailDetails): Promise<boolean> {
    const explorerLink = `https://stellar.expert/explorer/testnet/tx/${details.txHash}`;
    const subject = `Deposit Confirmed - ${details.amount} ${details.asset}`;
    
    const text = `Your deposit of ${details.amount} ${details.asset} has been confirmed on-chain.
Date: ${details.date}
Transaction Hash: ${details.txHash}
View on Stellar Explorer: ${explorerLink}`;

    const html = `
      <h1>Deposit Confirmed</h1>
      <p>Your deposit of <strong>${details.amount} ${details.asset}</strong> has been confirmed on-chain.</p>
      <ul>
        <li><strong>Date:</strong> ${details.date}</li>
        <li><strong>Transaction Hash:</strong> <code style="word-break: break-all;">${details.txHash}</code></li>
      </ul>
      <p><a href="${explorerLink}" target="_blank" style="padding: 10px 20px; background-color: #0070f3; color: white; text-decoration: none; border-radius: 5px;">View on Stellar Explorer</a></p>
    `;

    return this.sendEmail({ to, subject, text, html });
  }

  /**
   * Send withdrawal confirmation email.
   */
  async sendWithdrawalConfirmation(to: string, details: TransactionEmailDetails): Promise<boolean> {
    const explorerLink = `https://stellar.expert/explorer/testnet/tx/${details.txHash}`;
    const subject = `Withdrawal Confirmed - ${details.amount} ${details.asset}`;
    
    const text = `Your withdrawal of ${details.amount} ${details.asset} has been confirmed on-chain.
Date: ${details.date}
Transaction Hash: ${details.txHash}
View on Stellar Explorer: ${explorerLink}`;

    const html = `
      <h1>Withdrawal Confirmed</h1>
      <p>Your withdrawal of <strong>${details.amount} ${details.asset}</strong> has been confirmed on-chain.</p>
      <ul>
        <li><strong>Date:</strong> ${details.date}</li>
        <li><strong>Transaction Hash:</strong> <code style="word-break: break-all;">${details.txHash}</code></li>
      </ul>
      <p><a href="${explorerLink}" target="_blank" style="padding: 10px 20px; background-color: #0070f3; color: white; text-decoration: none; border-radius: 5px;">View on Stellar Explorer</a></p>
    `;

    return this.sendEmail({ to, subject, text, html });
  }

  /**
   * Simulates a call to the email provider API.
   */
  private async simulateProviderCall(options: EmailOptions): Promise<boolean> {
    if (this.provider === 'resend') {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            from: this.fromEmail,
            to: options.to,
            subject: options.subject,
            text: options.text,
            html: options.html,
          }),
        });
        return response.ok;
      } catch (error) {
        logger.log('error', 'Resend API call failed', { error });
        return false;
      }
    } else if (this.provider === 'sendgrid') {
      try {
        const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: options.to }] }],
            from: { email: this.fromEmail },
            subject: options.subject,
            content: [
              { type: 'text/plain', value: options.text },
              { type: 'text/html', value: options.html },
            ],
          }),
        });
        return response.ok;
      } catch (error) {
        logger.log('error', 'SendGrid API call failed', { error });
        return false;
      }
    }
    return false;
  }
}

export const emailService = new EmailService();
