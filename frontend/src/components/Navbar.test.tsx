import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Navbar from './Navbar';
import { ThemeProvider } from '../context/ThemeContext';
import { ToastProvider } from '../context/ToastContext';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PreferencesProvider } from '../context/PreferencesContext';

describe('Navbar', () => {
    const mockOnConnect = vi.fn();
    const mockOnDisconnect = vi.fn();
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
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
        const expectedAddress = 'GABC1...9012';
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

        expect(screen.getByText(expectedAddress)).toBeInTheDocument();
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
});
