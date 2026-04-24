import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import App from '../App';

// Mock the modules that are lazy loaded to test the loading state
vi.mock('../pages/Home', () => ({
  default: () => <div data-testid="home-page">Home Page</div>
}));

vi.mock('../pages/Portfolio', () => ({
  default: () => <div data-testid="portfolio-page">Portfolio Page</div>
}));

vi.mock('../components/Navbar', () => ({
  default: () => <div data-testid="navbar">Navbar</div>
}));

vi.mock('../components/ShortcutHelpModal', () => ({
  default: () => <div data-testid="shortcut-modal">Shortcut Modal</div>
}));

// Mock Sentry
vi.mock('@sentry/react', () => ({
  withSentryReactRouterV6Routing: <T,>(comp: T) => comp,
  ErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
  init: vi.fn(),
}));

// Mock useTranslation
vi.mock('../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}));

// Mock hooks to avoid network requests
vi.mock('../hooks/useBalanceData', () => ({
  useUsdcBalance: () => ({ data: 1000, isLoading: false })
}));

describe('Routing and Lazy Loading', () => {
  it('renders the loading fallback initially when navigating to a lazy route', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    // Shared route fallback renders while lazy chunks load
    expect(screen.getByText('app.loading.subtitle')).toBeDefined();

    // Wait for lazy component to load
    await waitFor(() => {
      expect(screen.getByTestId('home-page')).toBeDefined();
    });
  });

  it('navigates to portfolio and shows loading state', async () => {
    render(
      <MemoryRouter initialEntries={['/portfolio']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText('app.loading.subtitle')).toBeDefined();

    await waitFor(() => {
      expect(screen.getByTestId('portfolio-page')).toBeDefined();
    });
  });

  it('redirects to home for unknown routes', async () => {
    render(
      <MemoryRouter initialEntries={['/unknown-route']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('home-page')).toBeDefined();
    });
  });
});
