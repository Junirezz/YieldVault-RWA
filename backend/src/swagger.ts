import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import type { Express } from 'express';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.1.0',
    info: {
      title: 'YieldVault Stellar RWA API',
      version: '1.0.0',
      description: 'API documentation for the YieldVault Stellar RWA backend.',
      license: {
        name: 'MIT',
        url: 'https://spdx.org/licenses/MIT.html',
      },
      contact: {
        name: 'YieldVault Team',
        url: 'https://yieldvault.finance',
      },
    },
    servers: [
      {
        url: '/api/v1',
        description: 'API v1',
      },
    ],
    components: {
      securitySchemes: {
        IdempotencyKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-idempotency-key',
          description: 'Required for mutation requests to ensure idempotency.',
        },
      },
      schemas: {
        PaginationMeta: {
          type: 'object',
          properties: {
            count: { type: 'integer' },
            limit: { type: 'integer' },
            total: { type: 'integer', nullable: true },
            nextCursor: { type: 'string', nullable: true },
            prevCursor: { type: 'string', nullable: true },
            currentPage: { type: 'integer', nullable: true },
            totalPages: { type: 'integer', nullable: true },
            hasNextPage: { type: 'boolean' },
            hasPrevPage: { type: 'boolean' },
          },
        },
        VaultSummary: {
          type: 'object',
          properties: {
            totalAssets: { type: 'number' },
            totalShares: { type: 'number' },
            apy: { type: 'number' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            status: { type: 'integer' },
            message: { type: 'string' },
          },
        },
      },
    },
  },
  apis: ['./src/**/*.ts', './src/index.ts', './src/listEndpoints.ts', './src/swagger.ts'], // Files containing annotations
};

export const specs = swaggerJsdoc(options);

export function setupSwagger(app: Express) {
  const nodeEnv = process.env.NODE_ENV || 'development';

  if (nodeEnv !== 'production') {
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(specs));
    /* eslint-disable-next-line no-console */
    console.log('📝 Swagger documentation available at /docs');
  }
}
