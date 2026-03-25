### Frontend Observability with Sentry

This project uses Sentry for real-time error tracking and performance monitoring (Web Vitals).

# Quick Start

- Create a project at Sentry.io.
- Get your DSN (Client Key) from Project Settings > Client Keys.
- Add it to your local .env file:

# .env file

VITE_SENTRY_DSN=your_dsn_here
SENTRY_AUTH_TOKEN=your_actual_auth_token_string_here

## What is Tracked?

- Unhandled Exceptions: Captured automatically via the ErrorBoundary in App.tsx.
- Web Vitals: LCP, FID, and CLS are tracked to monitor user-perceived performance.
- Route Transitions: Using the React Router 7 integration to see which pages are slow.
- Session Replays: 10% of sessions are recorded (100% on error) to help debug UI-specific bugs.
