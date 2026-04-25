import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';

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
        url: 'http://localhost:3000',
        description: 'Development server',
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
            total: { type: 'integer' },
            nextCursor: { type: 'string' },
            prevCursor: { type: 'string' },
            currentPage: { type: 'integer' },
            totalPages: { type: 'integer' },
            hasNextPage: { type: 'boolean' },
            hasPrevPage: { type: 'boolean' },
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
  apis: ['./src/index.ts', './src/listEndpoints.ts', './src/swagger.ts'], // Files containing annotations
};

export const specs = swaggerJsdoc(options);

export function setupSwagger(app: Express) {
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  if (nodeEnv !== 'production') {
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(specs, {
      explorer: true,
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerOptions: {
        persistAuthorization: true,
      },
    }));
    
    app.get('/docs-json', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(specs);
    });

    console.log('📝 Swagger documentation available at /docs');
  }
}
