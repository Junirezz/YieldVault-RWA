/**
 * OpenTelemetry distributed tracing setup.
 * Must be imported BEFORE any other modules to ensure auto-instrumentation works.
 *
 * Configure via environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  - OTLP collector endpoint (default: http://localhost:4318)
 *   OTEL_SERVICE_NAME            - Service name (default: yieldvault-backend)
 *   OTEL_ENABLED                 - Set to "false" to disable (default: true)
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import {
  trace,
  context,
  SpanStatusCode,
  type Span,
  type Tracer,
} from '@opentelemetry/api';

const OTEL_ENABLED = process.env.NODE_ENV !== 'test' && process.env.OTEL_ENABLED !== 'false';
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'yieldvault-backend';
const OTLP_ENDPOINT =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

let sdk: NodeSDK | null = null;

export function initTracing(): void {
  // Skip all tracing initialization in test environments or if disabled
  if (!OTEL_ENABLED || IS_TEST_ENV) return;

  // Build the instrumentations array
  const instrumentations: any[] = [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
  ];

  // Only load PrismaInstrumentation in production (non-test) environments
  // The instrumentation package auto-registers hooks that can cause panics in tests
  // if the Prisma Query Engine doesn't receive the expected configuration
  if (!IS_TEST_ENV) {
    try {
      // Dynamically require to avoid loading the module at import time
      // This prevents auto-instrumentation hooks from being registered prematurely
      const PrismaInstrumentationModule = require('@prisma/instrumentation') as any;
      if (PrismaInstrumentationModule && PrismaInstrumentationModule.PrismaInstrumentation) {
        instrumentations.push(new PrismaInstrumentationModule.PrismaInstrumentation());
      }
    } catch (e) {
      console.warn(
        'Failed to load PrismaInstrumentation:',
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  const exporter = new OTLPTraceExporter({ url: `${OTLP_ENDPOINT}/v1/traces` });

  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
    }),
    traceExporter: exporter,
    instrumentations,
  });

  sdk.start();
}

export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
  }
}

/** Returns the active tracer for manual span creation. */
export function getTracer(): Tracer {
  return trace.getTracer(SERVICE_NAME);
}

/**
 * Wraps an async function in a named span.
 * Automatically records exceptions and sets error status.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  if (!OTEL_ENABLED) return fn(trace.getTracer(SERVICE_NAME).startSpan(name));

  const tracer = getTracer();
  return tracer.startActiveSpan(name, async (span) => {
    if (attributes) {
      span.setAttributes(attributes);
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Returns the current trace ID for inclusion in log lines. */
export function getCurrentTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  if (!span) return undefined;
  const ctx = span.spanContext();
  return ctx.traceId !== '00000000000000000000000000000000' ? ctx.traceId : undefined;
}

export { context, SpanStatusCode };
