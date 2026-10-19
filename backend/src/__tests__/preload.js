process.env.NODE_ENV = 'test';
process.env.OTEL_ENABLED = 'false';
process.env.ALLOWLIST_ENABLED = process.env.ALLOWLIST_ENABLED || 'false';
process.env.RATE_LIMIT_AUTH_MAX = process.env.RATE_LIMIT_AUTH_MAX || '100000';
process.env.RATE_LIMIT_WRITES_MAX = process.env.RATE_LIMIT_WRITES_MAX || '100000';
process.env.RATE_LIMIT_READS_MAX = process.env.RATE_LIMIT_READS_MAX || '100000';
process.env.RATE_LIMIT_ADMIN_MAX = process.env.RATE_LIMIT_ADMIN_MAX || '100000';
process.env.API_RATE_LIMIT_MAX_REQUESTS = process.env.API_RATE_LIMIT_MAX_REQUESTS || '100000';

const mime = require('mime');
if (typeof mime.getType !== 'function') {
  mime.getType = function(path) {
    return mime.lookup(path);
  };
}
