import type { ReactNode } from "react";
import ErrorBoundary from "./ErrorBoundary";
import { captureException } from "../config/sentry";

interface RouteErrorBoundaryProps {
  /** Identifies which route/page crashed in error monitoring. */
  routeName: string;
  children: ReactNode;
}

/**
 * Isolates a single routed page so a render error there shows a
 * user-friendly fallback (with retry) instead of blanking the whole app,
 * and reports the failure to Sentry for monitoring.
 */
export default function RouteErrorBoundary({ routeName, children }: RouteErrorBoundaryProps) {
  return (
    <ErrorBoundary onError={(error) => captureException(error, { route: routeName })}>
      {children}
    </ErrorBoundary>
  );
}
