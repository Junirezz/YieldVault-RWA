// Mock for all @opentelemetry/* packages in tests.
//
// Must mirror the real API surface used by src/tracing.ts and
// src/middleware/correlationId.ts. A previous generic-Proxy version
// returned undefined from trace.getTracer(), so every HTTP request
// threw `TypeError: Cannot read properties of undefined (reading
// 'startSpan')` in correlationId middleware.
function createNoopSpan() {
  return {
    setAttributes: () => {},
    setAttribute: () => {},
    setStatus: () => {},
    recordException: () => {},
    updateName: () => {},
    addEvent: () => {},
    end: () => {},
    isRecording: () => false,
    spanContext: () => ({
      traceId: '00000000000000000000000000000000',
      spanId: '0000000000000000',
      traceFlags: 0,
    }),
  };
}

function createNoopTracer() {
  return {
    startSpan: () => createNoopSpan(),
    startActiveSpan: (name, arg2, arg3) => {
      const fn = typeof arg2 === 'function' ? arg2 : arg3;
      const span = createNoopSpan();
      if (typeof fn === 'function') return fn(span);
      return span;
    },
  };
}

const trace = {
  getTracer: () => createNoopTracer(),
  getActiveSpan: () => undefined,
  getSpan: () => undefined,
  setSpan: (contextArg, span) => span ?? contextArg,
  deleteSpan: (contextArg) => contextArg,
};

const context = {
  active: () => ({}),
  with: (ctx, fn, thisArg, ...args) =>
    typeof fn === 'function' ? fn.apply(thisArg, args) : undefined,
  bind: (ctx, target) => target,
};

const propagation = {
  extract: (contextArg) => contextArg ?? {},
  inject: () => {},
  fields: () => [],
};

const SpanStatusCode = { UNSET: 0, OK: 1, ERROR: 2 };
const SpanKind = { INTERNAL: 0, SERVER: 1, CLIENT: 2, PRODUCER: 3, CONSUMER: 4 };
const TraceFlags = { NONE: 0, SAMPLED: 1 };
const ROOT_CONTEXT = {};
const INVALID_SPAN_CONTEXT = {
  traceId: '00000000000000000000000000000000',
  spanId: '0000000000000000',
  traceFlags: 0,
};

class NoopInstrumentation {
  constructor(...args) {
    this.args = args;
  }
  enable() {}
  disable() {}
  setConfig() {}
  getConfig() {
    return {};
  }
}

class NoopSdk {
  constructor(...args) {
    this.args = args;
  }
  start() {}
  shutdown() {
    return Promise.resolve();
  }
  forceFlush() {
    return Promise.resolve();
  }
}

function noopExporter() {
  return {
    export: (_spans, resultCallback) => {
      if (typeof resultCallback === 'function') resultCallback({ code: 0 });
    },
    shutdown: () => Promise.resolve(),
  };
}

function resourceFromAttributes(attributes) {
  return { attributes: attributes ?? {} };
}

const baseExports = {
  __esModule: true,
  trace,
  context,
  propagation,
  SpanStatusCode,
  SpanKind,
  TraceFlags,
  ROOT_CONTEXT,
  INVALID_SPAN_CONTEXT,
  // SDK / exporter / instrumentation constructors used by src/tracing.ts
  NodeSDK: NoopSdk,
  OTLPTraceExporter: NoopSdk,
  HttpInstrumentation: NoopInstrumentation,
  ExpressInstrumentation: NoopInstrumentation,
  resourceFromAttributes,
};

// Fallback for any other named export (e.g. ATTR_SERVICE_NAME,
// ATTR_SERVICE_VERSION, other instrumentations): attribute constants
// resolve to their name, everything else to a generic noop constructor
// that is safe to call with `new`, call directly, or access deeply.
function fallbackFor(prop) {
  if (typeof prop === 'string' && prop.startsWith('ATTR_')) return prop;
  const noop = function (...args) {
    return { args };
  };
  return new Proxy(noop, {
    get: (target, key) => {
      if (key === '__esModule') return false;
      return fallbackFor(key);
    },
    apply: () => ({}),
    construct: () => ({ start: () => {}, shutdown: () => Promise.resolve() }),
  });
}

module.exports = new Proxy(baseExports, {
  get: (target, prop) => {
    if (prop in target) return target[prop];
    if (prop === 'default') return target;
    return fallbackFor(prop);
  },
});
module.exports.default = module.exports;
