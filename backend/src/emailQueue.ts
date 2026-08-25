import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './prismaClient';
import { emailService, EmailOptions } from './emailService';
import { logger } from './middleware/structuredLogging';
import { captureRequestContext } from './requestContext';

interface EmailQueueItem {
  id: string;
  to: string;
  subject: string;
  text: string;
  html?: string | null;
  status: string;
  retryCount: number;
  maxRetries: number;
  lastError?: string | null;
  nextRetryAt?: Date | null;
  createdAt?: Date;
}

export class EmailQueueService {
  private prisma: PrismaClient;
  private processingInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor() {
    this.prisma = getPrismaClient();
  }

  private get queueDelegate(): any {
    return (this.prisma as any).emailQueue;
  }

  async enqueueEmail(options: EmailOptions): Promise<EmailQueueItem> {
    // Capture context at enqueue time so it can be used when sending.
    // Note: the EmailQueue model doesn't persist context fields, so
    // propagation relies on AsyncLocalStorage being available when processed.
    void captureRequestContext();

    return this.queueDelegate.create({
      data: {
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        status: 'pending',
        retryCount: 0,
        maxRetries: 5,
      },
    });
  }

  private calculateNextRetry(retryCount: number): Date {
    const delay = Math.min(1000 * Math.pow(2, retryCount), 60000); // Exponential backoff, max 60 seconds
    return new Date(Date.now() + delay);
  }

  async processQueue(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;
    try {
      const pendingEmails = await this.queueDelegate.findMany({
        where: {
          status: {
            in: ['pending', 'failed'],
          },
          OR: [
            { nextRetryAt: null },
            { nextRetryAt: { lte: new Date() } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });

      for (const email of pendingEmails) {
        await this.processEmail(email);
      }
    } catch (error) {
      logger.log('error', 'Error processing email queue', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.isProcessing = false;
    }
  }

  private async processEmail(email: EmailQueueItem): Promise<void> {
    try {
      await this.queueDelegate.update({
        where: { id: email.id },
        data: { status: 'processing' },
      });

      const success = await emailService.sendEmailDirectly({
        to: email.to,
        subject: email.subject,
        text: email.text ?? '',
        html: email.html ?? '',
      });

      if (success) {
        await this.queueDelegate.update({
          where: { id: email.id },
          data: { status: 'completed' },
        });
        logger.log('info', 'Email sent successfully from queue', { emailId: email.id });
      } else {
        await this.handleFailure(email, 'Email send failed');
      }
    } catch (error) {
      await this.handleFailure(email, error instanceof Error ? error.message : String(error));
    }
  }

  private async handleFailure(email: EmailQueueItem, errorMessage: string): Promise<void> {
    const newRetryCount = email.retryCount + 1;

    if (newRetryCount >= email.maxRetries) {
      await this.queueDelegate.update({
        where: { id: email.id },
        data: {
          status: 'dead-letter',
          retryCount: newRetryCount,
          lastError: errorMessage,
        },
      });
      logger.log('error', 'Email moved to dead-letter', {
        emailId: email.id,
        error: errorMessage,
      });
      void this.sendDeadLetterAlert(email.id, email.to, errorMessage);
    } else {
      const nextRetryAt = this.calculateNextRetry(newRetryCount);
      await this.queueDelegate.update({
        where: { id: email.id },
        data: {
          status: 'failed',
          retryCount: newRetryCount,
          lastError: errorMessage,
          nextRetryAt,
        },
      });
      logger.log('warn', 'Email failed, will retry', {
        emailId: email.id,
        retryCount: newRetryCount,
        nextRetryAt,
      });
    }
  }

  async getEmailQueue(status?: string): Promise<EmailQueueItem[]> {
    const where = status ? { status } : {};
    return this.queueDelegate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async replayEmail(emailId: string): Promise<EmailQueueItem> {
    await this.queueDelegate.findUniqueOrThrow({
      where: { id: emailId },
    });

    return this.queueDelegate.update({
      where: { id: emailId },
      data: {
        status: 'pending',
        retryCount: 0,
        lastError: null,
        nextRetryAt: null,
      },
    });
  }

  private async sendDeadLetterAlert(emailId: string, toAddress: string, error: string): Promise<void> {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL || process.env.ALERT_WEBHOOK_URL;
    if (!webhookUrl) return;

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `:rotating_light: *YieldVault Email Dead-Lettered*\nFailed to send email to \`${toAddress}\` (ID: ${emailId}).\nLatest error: \`${error}\``
        })
      });
    } catch (err) {
      logger.log('error', 'Failed to send email dead-letter alert', {
        error: err instanceof Error ? err.message : String(err),
        emailId
      });
    }
  }

  startWorker(intervalMs: number = 5000): void {
    if (this.processingInterval) return;
    this.processingInterval = setInterval(() => this.processQueue(), intervalMs);
    logger.log('info', 'Email queue worker started');
  }

  stopWorker(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      logger.log('info', 'Email queue worker stopped');
    }
  }
}

export const emailQueueService = new EmailQueueService();

