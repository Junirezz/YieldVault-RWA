import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Navbar from './Navbar';
import { ThemeProvider } from '../context/ThemeContext';
import { ToastProvider } from '../context/ToastContext';
import { MemoryRouter } from 'react-router-dom';

describe('Navbar', () => {
    const mockOnConnect = vi.fn();
    const mockOnDisconnect = vi.fn();
    const mockOnNavigate = vi.fn();

    it('renders the navbar with navigation links', () => {
        render(
            <MemoryRouter>
                <ToastProvider>
                    <ThemeProvider>
                        <Navbar
                            currentPath="/"
                            onNavigate={mockOnNavigate}
                            walletAddress={null}
                            onConnect={mockOnConnect}
                            onDisconnect={mockOnDisconnect}
                        />
                    </ThemeProvider>
                </ToastProvider>
            </MemoryRouter>
        );

        expect(screen.getByText(/YieldVault/)).toBeInTheDocument();
        expect(screen.getByText(/RWA/)).toBeInTheDocument();
        expect(screen.getByText('Vaults')).toBeInTheDocument();
        expect(screen.getByText('Analytics')).toBeInTheDocument();
        expect(screen.getByText('Portfolio')).toBeInTheDocument();
    });

    it('renders the wallet connect button', () => {
        render(
            <MemoryRouter>
                <ToastProvider>
                    <ThemeProvider>
                        <Navbar
                            currentPath="/"
                            onNavigate={mockOnNavigate}
                            walletAddress={null}
                            onConnect={mockOnConnect}
                            onDisconnect={mockOnDisconnect}
                        />
                    </ThemeProvider>
                </ToastProvider>
            </MemoryRouter>
        );

        expect(screen.getByText(/Connect Freighter/i)).toBeInTheDocument();
    });

    it('shows the truncated wallet address when connected', () => {
        const fullAddress = 'GABC1234567890123456789012345678901234567890123456789012';
        const expectedAddress = 'GABC1...9012';
        render(
            <MemoryRouter>
                <ToastProvider>
                    <ThemeProvider>
                        <Navbar
                            currentPath="/portfolio"
                            onNavigate={mockOnNavigate}
                            walletAddress={fullAddress}
                            onConnect={mockOnConnect}
                            onDisconnect={mockOnDisconnect}
                        />
                    </ThemeProvider>
                </ToastProvider>
            </MemoryRouter>
        );

        expect(screen.getByText(expectedAddress)).toBeInTheDocument();
    });
});
