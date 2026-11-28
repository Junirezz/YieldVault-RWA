import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PreferencesProvider } from '../context/PreferencesContext';
import Navbar from './Navbar';
import { ThemeProvider } from '../context/ThemeContext';
import { ToastProvider } from '../context/ToastContext';
import { WithdrawalNotificationProvider } from '../context/WithdrawalNotificationContext';
import { MemoryRouter } from 'react-router-dom';

describe('Navbar', () => {
    const mockOnConnect = vi.fn();
    const mockOnDisconnect = vi.fn();
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });

    function renderNavbar(ui: ReactElement) {
        return render(
            <MemoryRouter>
                <QueryClientProvider client={queryClient}>
                    <PreferencesProvider>
                        <ToastProvider>
                            <ThemeProvider>
                                <WithdrawalNotificationProvider>
                                    {ui}
                                </WithdrawalNotificationProvider>
                            </ThemeProvider>
                        </ToastProvider>
                    </PreferencesProvider>
                </QueryClientProvider>
            </MemoryRouter>
        );
    }

    beforeEach(() => {
        localStorage.setItem(
            'yieldvault-preferences:guest',
            JSON.stringify({ maskSensitiveValues: false }),
        );
    });

    it('renders the navbar with navigation links', () => {
        renderNavbar(
            <Navbar
                walletAddress={null}
                onConnect={mockOnConnect}
                onDisconnect={mockOnDisconnect}
            />,
        );

        expect(screen.getByText(/YieldVault/)).toBeInTheDocument();
        expect(screen.getByText(/RWA/)).toBeInTheDocument();
        expect(screen.getAllByText('Vaults')[0]).toBeInTheDocument();
        expect(screen.getAllByText('Analytics')[0]).toBeInTheDocument();
        expect(screen.getAllByText('Portfolio')[0]).toBeInTheDocument();
    });

    it('renders the wallet connect button', () => {
        renderNavbar(
            <Navbar
                walletAddress={null}
                onConnect={mockOnConnect}
                onDisconnect={mockOnDisconnect}
            />,
        );

        expect(screen.getByText(/Connect Freighter/i)).toBeInTheDocument();
    });

    it('shows the truncated wallet address when connected', () => {
        const fullAddress = 'GABC1234567890123456789012345678901234567890123456789012';
        // Default preference masks identifiers while keeping edge characters.
        renderNavbar(
            <Navbar
                walletAddress={fullAddress}
                onConnect={mockOnConnect}
                onDisconnect={mockOnDisconnect}
            />,
        );

        // Default preferences mask sensitive values (GABC...9012).
        expect(screen.getByText(/GABC.+9012/)).toBeInTheDocument();
    });

    it('shows a network badge when wallet is connected', () => {
        const fullAddress = 'GABC1234567890123456789012345678901234567890123456789012';
        renderNavbar(
            <Navbar
                walletAddress={fullAddress}
                onConnect={mockOnConnect}
                onDisconnect={mockOnDisconnect}
            />,
        );

        expect(screen.getAllByText(/testnet|mainnet/i)[0]).toBeInTheDocument();
    });

    it('does not show the Admin link by default (guest role)', () => {
        renderNavbar(
            <Navbar
                walletAddress={null}
                onConnect={mockOnConnect}
                onDisconnect={mockOnDisconnect}
            />,
        );

        expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    });

    it('shows the Admin link when role is admin', () => {
        const fullAddress = 'GABC1234567890123456789012345678901234567890123456789012';
        renderNavbar(
            <Navbar
                walletAddress={fullAddress}
                onConnect={mockOnConnect}
                onDisconnect={mockOnDisconnect}
                role="admin"
            />,
        );

        expect(screen.getAllByText('Admin')[0]).toBeInTheDocument();
    });

    it('does not show the Admin link for a connected investor wallet', () => {
        const fullAddress = 'GABC1234567890123456789012345678901234567890123456789012';
        renderNavbar(
            <Navbar
                walletAddress={fullAddress}
                onConnect={mockOnConnect}
                onDisconnect={mockOnDisconnect}
                role="investor"
            />,
        );

        expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    });
});
