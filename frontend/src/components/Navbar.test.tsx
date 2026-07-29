import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PreferencesProvider } from '../context/PreferencesContext';
import Navbar from './Navbar';
import { ThemeProvider } from '../context/ThemeContext';
import { ToastProvider } from '../context/ToastContext';
import { MemoryRouter } from 'react-router-dom';

describe('Navbar', () => {
    const mockOnConnect = vi.fn();
    const mockOnDisconnect = vi.fn();
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });

    beforeEach(() => {
        localStorage.setItem(
            'yieldvault-preferences:guest',
            JSON.stringify({ maskSensitiveValues: false }),
        );
    });

    it('renders the navbar with navigation links', () => {
        render(
            <MemoryRouter>
                <QueryClientProvider client={queryClient}>
                    <PreferencesProvider>
                        <ToastProvider>
                        <ThemeProvider>
                            <Navbar
                                walletAddress={null}
                                onConnect={mockOnConnect}
                                onDisconnect={mockOnDisconnect}
                            />
                        </ThemeProvider>
                    </ToastProvider>
                </PreferencesProvider>
            </QueryClientProvider>
            </MemoryRouter>
        );

        expect(screen.getByText(/YieldVault/)).toBeInTheDocument();
        expect(screen.getByText(/RWA/)).toBeInTheDocument();
        expect(screen.getAllByText('Vaults')[0]).toBeInTheDocument();
        expect(screen.getAllByText('Analytics')[0]).toBeInTheDocument();
        expect(screen.getAllByText('Portfolio')[0]).toBeInTheDocument();
    });

    it('renders the wallet connect button', () => {
        render(
            <MemoryRouter>
                <QueryClientProvider client={queryClient}>
                    <PreferencesProvider>
                        <ToastProvider>
                        <ThemeProvider>
                            <Navbar
                                walletAddress={null}
                                onConnect={mockOnConnect}
                                onDisconnect={mockOnDisconnect}
                            />
                        </ThemeProvider>
                    </ToastProvider>
                </PreferencesProvider>
            </QueryClientProvider>
            </MemoryRouter>
        );

        expect(screen.getByText(/Connect Freighter/i)).toBeInTheDocument();
    });

    it('shows the truncated wallet address when connected', () => {
        const fullAddress = 'GABC1234567890123456789012345678901234567890123456789012';
        // Default preference masks identifiers while keeping edge characters.
        render(
            <MemoryRouter>
                <QueryClientProvider client={queryClient}>
                    <PreferencesProvider>
                        <ToastProvider>
                        <ThemeProvider>
                            <Navbar
                                walletAddress={fullAddress}
                                onConnect={mockOnConnect}
                                onDisconnect={mockOnDisconnect}
                            />
                        </ThemeProvider>
                    </ToastProvider>
                </PreferencesProvider>
            </QueryClientProvider>
            </MemoryRouter>
        );

        // Default preferences mask sensitive values (GABC...9012).
        expect(screen.getByText(/GABC.+9012/)).toBeInTheDocument();
    });

    it('shows a network badge when wallet is connected', () => {
        const fullAddress = 'GABC1234567890123456789012345678901234567890123456789012';
        render(
            <MemoryRouter>
                <QueryClientProvider client={queryClient}>
                    <PreferencesProvider>
                        <ToastProvider>
                        <ThemeProvider>
                            <Navbar
                                walletAddress={fullAddress}
                                onConnect={mockOnConnect}
                                onDisconnect={mockOnDisconnect}
                            />
                        </ThemeProvider>
                    </ToastProvider>
                </PreferencesProvider>
            </QueryClientProvider>
            </MemoryRouter>
        );

        expect(screen.getAllByText(/testnet|mainnet/i)[0]).toBeInTheDocument();
    });

    it('does not show the Admin link by default (guest role)', () => {
        render(
            <MemoryRouter>
                <QueryClientProvider client={queryClient}>
                    <PreferencesProvider>
                        <ToastProvider>
                        <ThemeProvider>
                            <Navbar
                                walletAddress={null}
                                onConnect={mockOnConnect}
                                onDisconnect={mockOnDisconnect}
                            />
                        </ThemeProvider>
                    </ToastProvider>
                </PreferencesProvider>
            </QueryClientProvider>
            </MemoryRouter>
        );

        expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    });

    it('shows the Admin link when role is admin', () => {
        const fullAddress = 'GABC1234567890123456789012345678901234567890123456789012';
        render(
            <MemoryRouter>
                <QueryClientProvider client={queryClient}>
                    <PreferencesProvider>
                        <ToastProvider>
                        <ThemeProvider>
                            <Navbar
                                walletAddress={fullAddress}
                                onConnect={mockOnConnect}
                                onDisconnect={mockOnDisconnect}
                                role="admin"
                            />
                        </ThemeProvider>
                    </ToastProvider>
                </PreferencesProvider>
            </QueryClientProvider>
            </MemoryRouter>
        );

        expect(screen.getAllByText('Admin')[0]).toBeInTheDocument();
    });

    it('does not show the Admin link for a connected investor wallet', () => {
        const fullAddress = 'GABC1234567890123456789012345678901234567890123456789012';
        render(
            <MemoryRouter>
                <QueryClientProvider client={queryClient}>
                    <PreferencesProvider>
                        <ToastProvider>
                        <ThemeProvider>
                            <Navbar
                                walletAddress={fullAddress}
                                onConnect={mockOnConnect}
                                onDisconnect={mockOnDisconnect}
                                role="investor"
                            />
                        </ThemeProvider>
                    </ToastProvider>
                </PreferencesProvider>
            </QueryClientProvider>
            </MemoryRouter>
        );

        expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    });
});
