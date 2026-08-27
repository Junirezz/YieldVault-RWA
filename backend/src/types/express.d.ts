declare global {
  namespace Express {
    interface Request {
      authApiKeyHash?: string;
      authApiKeyRole?: string;
      apiVersion?: 'v1' | 'v2';
      apiVersionSource?: 'path' | 'legacy' | 'default';
    }
  }
}

export {};
