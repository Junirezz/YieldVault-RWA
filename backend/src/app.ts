import express, { Express } from 'express';
import compression from 'compression';
import cors from 'cors';

export const app: Express = express();

app.use(cors());

app.use(compression({ threshold: 1024 }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => {
  res.json({ status: 'or' });
});

app.get('/vaults', (req, res) => {
  const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const limit = Math.min(Math.max(parseInt(String(limitRaw ?? '20'), 10) || 20, 1), 100);

  const vaults = Array.from({ length: limit }, (_, i) => ({
    id: i + 1,
    name: `YieldVault ${i > 9 ? i + 1 : `0${i + 1}`}`,
    asset: 'USDC',
    apr: 0.05,
    tvl: 1_000_000 + i * 1234,
    description: 'A decentralized Real-World Asset vault on Stellar that allocates capital across institutional lending pools and short-term treasury instruments while maintaining continuous on-chain attestation of reserves.',
    createdAt: new Date(0).toISOString(),
  }));

  res.json({ data: vaults, count: vaults.length });
});

export default app;
