import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WalletConnect from './WalletConnect';
import * as freighter from '@stellar/freighter-api';
import * as walletSession from '../lib/walletSession';
import { ToastProvider } from '../context/ToastContext';
import { PreferencesProvider } from '../context/PreferencesContext';


// Mock freighter-api
vi.mock('@stellar/freighter-api', () => ({
    isConnected: vi.fn(),
    isAllowed: vi.fn(),
    setAllowed: vi.fn(),
    getAddress: vi.fn(),
}));

vi.mock('../lib/walletSession', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../lib/walletSession')>();
    return {
        ...actual,
        getLastWalletProvider: vi.fn(),
        isProviderAvailable: vi.fn(),
    };
});

const mockedFreighter = vi.mocked(freighter);
const mockedWalletSession = vi.mocked(walletSession);

const WalletConnectWrapper: React.FC<ComponentProps<typeof WalletConnect>> = (props) => (
    <PreferencesProvider>
        <ToastProvider>
            <WalletConnect {...props} />
        </ToastProvider>
    </PreferencesProvider>
);

describe('WalletConnect', () => {
    const mockOnConnect = vi.fn();
    const mockOnDisconnect = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
        localStorage.setItem(
            'yieldvault-preferences:guest',
            JSON.stringify({ maskSensitiveValues: false }),
        );
        mockedFreighter.isConnected.mockResolvedValue({ isConnected: true });
        mockedWalletSession.getLastWalletProvider.mockReturnValue(null);
        mockedWalletSession.isProviderAvailable.mockResolvedValue(true);
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('renders the connect button when no wallet is connected', async () => {
        mockedFreighter.isAllowed.mockResolvedValue({ isAllowed: false });
        render(
            <WalletConnectWrapper 
                walletAddress={null} 
                onConnect={mockOnConnect} 
                onDisconnect={mockOnDisconnect} 
            />
        );

        expect(screen.getByText(/Connect Freighter/i)).toBeInTheDocument();
    });

    it('shows error state when Freighter is not installed', async () => {
        mockedFreighter.setAllowed.mockRejectedValue(
            new Error('Freighter is not installed'),
        );
        render(
            <WalletConnectWrapper 
                walletAddress={null} 
                onConnect={mockOnConnect} 
                onDisconnect={mockOnDisconnect} 
            />
        );

        const button = screen.getByText(/Connect Freighter/i);
        fireEvent.click(button);

        await waitFor(() => {
            expect(mockOnConnect).not.toHaveBeenCalled();
            expect(document.querySelector('[data-error-code="NOT_INSTALLED"]')).toBeInTheDocument();
            const btn = screen.getByText(/Connect Freighter/i).closest('button');
            expect(btn).toHaveClass('btn-danger');
            expect(btn).toHaveClass('is-error');
        });
    });

    it('shows loading state while connecting', async () => {
        mockedFreighter.isAllowed.mockResolvedValue({ isAllowed: false });
        mockedFreighter.setAllowed.mockImplementation(() => new Promise(() => undefined));
        
        render(
            <WalletConnectWrapper 
                walletAddress={null} 
                onConnect={mockOnConnect} 
                onDisconnect={mockOnDisconnect} 
            />
        );

        const button = screen.getByText(/Connect Freighter/i);
        fireEvent.click(button);

        // Should show connecting state — at least one element contains "Connecting"
        expect(screen.getAllByText(/Connecting/i).length).toBeGreaterThan(0);
    });

    it('calls onConnect when manually connected via button', async () => {
        mockedFreighter.isAllowed
            .mockResolvedValueOnce({ isAllowed: false })
            .mockResolvedValueOnce({ isAllowed: true });
        mockedFreighter.setAllowed.mockResolvedValue({ isAllowed: true });
        mockedFreighter.getAddress.mockResolvedValue({ address: 'GABC123' });

        render(
            <WalletConnectWrapper 
                walletAddress={null} 
                onConnect={mockOnConnect} 
                onDisconnect={mockOnDisconnect} 
            />
        );

        const button = screen.getByText(/Connect Freighter/i);
        fireEvent.click(button);

        await waitFor(() => {
            expect(mockOnConnect).toHaveBeenCalledWith('GABC123');
        });
    });

    it('shows error state when permission is denied', async () => {
        mockedFreighter.isAllowed.mockResolvedValueOnce({ isAllowed: false });
        mockedFreighter.setAllowed.mockResolvedValue({ isAllowed: false });
        mockedFreighter.getAddress.mockResolvedValue({ address: "" });
        mockedFreighter.getAddress.mockResolvedValue({ address: "GABC123" });

        render(
            <WalletConnectWrapper 
                walletAddress={null} 
                onConnect={mockOnConnect} 
                onDisconnect={mockOnDisconnect} 
            />
        );

        const button = screen.getByText(/Connect Freighter/i);
        fireEvent.click(button);

        await waitFor(() => {
            expect(mockOnConnect).not.toHaveBeenCalled();
        });
    });

    it('shows error state when connection fails', async () => {
        mockedFreighter.setAllowed.mockRejectedValueOnce(new Error('Freighter not found'));

        render(
            <WalletConnectWrapper 
                walletAddress={null} 
                onConnect={mockOnConnect} 
                onDisconnect={mockOnDisconnect} 
            />
        );

        const button = screen.getByText(/Connect Freighter/i);
        fireEvent.click(button);

        await waitFor(() => {
            expect(mockOnConnect).not.toHaveBeenCalled();
        });
    });

    it('displays tooltip on button hover', async () => {
        mockedFreighter.isAllowed.mockResolvedValue({ isAllowed: false });
        
        render(
            <WalletConnectWrapper 
                walletAddress={null} 
                onConnect={mockOnConnect} 
                onDisconnect={mockOnDisconnect} 
            />
        );

        const button = screen.getByText(/Connect Freighter/i).closest('button');
        if (!button) throw new Error('Button not found');

        fireEvent.mouseEnter(button);
        
        // Tooltip should appear
        await waitFor(() => {
            expect(button).toHaveAttribute('title');
        });
    });

    it('hides tooltip on button mouse leave', async () => {
        mockedFreighter.isAllowed.mockResolvedValue({ isAllowed: false });
        
        render(
            <WalletConnectWrapper 
                walletAddress={null} 
                onConnect={mockOnConnect} 
                onDisconnect={mockOnDisconnect} 
            />
        );

        const button = screen.getByText(/Connect Freighter/i).closest('button');
        if (!button) throw new Error('Button not found');

        fireEvent.mouseEnter(button);
        fireEvent.mouseLeave(button);
        
        // Button should have title attribute for accessibility fallback
        expect(button).toHaveAttribute('title');
    });

    it('shows the formatted address when connected', () => {
        const fullAddress = 'GABC1234567890123456789012345678901234567890123456789012';

        render(
            <WalletConnectWrapper 
                walletAddress={fullAddress} 
                onConnect={mockOnConnect} 
                onDisconnect={mockOnDisconnect} 
            />
        );

        // Default preferences mask sensitive values (GABC...9012).
        expect(screen.getByTitle(fullAddress)).toBeInTheDocument();
        expect(screen.getByText(/GABC.+9012/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Copy wallet address/i })).toBeInTheDocument();
    });

    it('calls onDisconnect when the disconnect button is clicked', () => {
        render(
            <WalletConnectWrapper 
                walletAddress="GABC123...9012" 
                onConnect={mockOnConnect} 
                onDisconnect={mockOnDisconnect} 
            />
        );

        const disconnectButton = screen.getByLabelText(/Disconnect Wallet/i);
        fireEvent.click(disconnectButton);

        expect(mockOnDisconnect).toHaveBeenCalled();
    });

    it('handles wallet disconnects gracefully during polling', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        mockedFreighter.isConnected.mockResolvedValue({ isConnected: true });
        mockedFreighter.isAllowed
            .mockResolvedValueOnce({ isAllowed: true })
            .mockResolvedValue({ isAllowed: false });
        mockedFreighter.getAddress.mockResolvedValue({ address: 'GABC123' });

        render(
            <WalletConnectWrapper
                walletAddress="GABC123"
                onConnect={mockOnConnect}
                onDisconnect={mockOnDisconnect}
            />
        );

        await act(async () => {
            await vi.advanceTimersByTimeAsync(250);
        });

        expect(mockOnDisconnect).toHaveBeenCalledWith('connection-lost');
        
        vi.useRealTimers();
    });

    it('shows reconnect prompt when a provider is persisted and no manual disconnect', async () => {
        localStorage.setItem('yieldvault_last_wallet_provider', 'freighter');
        sessionStorage.removeItem('yieldvault_wallet_manual_disconnect');
        mockedWalletSession.getLastWalletProvider.mockReturnValue('freighter');

        render(
            <WalletConnectWrapper
                walletAddress={null}
                onConnect={mockOnConnect}
                onDisconnect={mockOnDisconnect}
            />
        );

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.getByText(/Welcome back/i)).toBeInTheDocument();

        localStorage.clear();
    });

    it('does not show reconnect prompt when manual disconnect is set', () => {
        localStorage.setItem('yieldvault_last_wallet_provider', 'freighter');
        sessionStorage.setItem('yieldvault_wallet_manual_disconnect', '1');

        render(
            <WalletConnectWrapper
                walletAddress={null}
                onConnect={mockOnConnect}
                onDisconnect={mockOnDisconnect}
            />
        );

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        localStorage.clear();
        sessionStorage.clear();
    });

    it('does not show reconnect prompt when no provider is persisted', () => {
        localStorage.removeItem('yieldvault_last_wallet_provider');

        render(
            <WalletConnectWrapper
                walletAddress={null}
                onConnect={mockOnConnect}
                onDisconnect={mockOnDisconnect}
            />
        );

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('dismissing reconnect prompt clears the persisted provider', async () => {
        localStorage.setItem('yieldvault_last_wallet_provider', 'freighter');
        sessionStorage.removeItem('yieldvault_wallet_manual_disconnect');
        mockedWalletSession.getLastWalletProvider.mockReturnValue('freighter');

        render(
            <WalletConnectWrapper
                walletAddress={null}
                onConnect={mockOnConnect}
                onDisconnect={mockOnDisconnect}
            />
        );

        fireEvent.click(await screen.findByRole('button', { name: /Use a different wallet/i }));

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(localStorage.getItem('yieldvault_last_wallet_provider')).toBeNull();

        localStorage.clear();
    });

    it('does not show reconnect prompt when prompt is dismissed in current session', async () => {
        localStorage.setItem('yieldvault_last_wallet_provider', 'freighter');
        sessionStorage.removeItem('yieldvault_wallet_manual_disconnect');
        sessionStorage.setItem('yieldvault_wallet_reconnect_prompt_dismissed', '1');
        mockedFreighter.isConnected.mockResolvedValue({ isConnected: true });

        render(
            <WalletConnectWrapper
                walletAddress={null}
                onConnect={mockOnConnect}
                onDisconnect={mockOnDisconnect}
            />
        );

        await waitFor(() => {
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        localStorage.clear();
        sessionStorage.clear();
    });

    it('clears reconnect prompt dismissed state on successful connection', async () => {
        mockedFreighter.isAllowed
            .mockResolvedValueOnce({ isAllowed: false })
            .mockResolvedValueOnce({ isAllowed: true });
        mockedFreighter.setAllowed.mockResolvedValue({ isAllowed: true });
        mockedFreighter.getAddress.mockResolvedValue({ address: 'GABC123' });
        sessionStorage.setItem('yieldvault_wallet_reconnect_prompt_dismissed', '1');

        render(
            <WalletConnectWrapper
                walletAddress={null}
                onConnect={mockOnConnect}
                onDisconnect={mockOnDisconnect}
            />
        );

        const button = screen.getByText(/Connect Freighter/i);
        fireEvent.click(button);

        await waitFor(() => {
            expect(mockOnConnect).toHaveBeenCalledWith('GABC123');
            expect(sessionStorage.getItem('yieldvault_wallet_reconnect_prompt_dismissed')).toBeNull();
        });

        sessionStorage.clear();
    });

    it('dismisses reconnect prompt sets the session dismiss flag', async () => {
        localStorage.setItem('yieldvault_last_wallet_provider', 'freighter');
        sessionStorage.removeItem('yieldvault_wallet_manual_disconnect');
        sessionStorage.removeItem('yieldvault_wallet_reconnect_prompt_dismissed');
        mockedFreighter.isConnected.mockResolvedValue({ isConnected: true });
        mockedWalletSession.getLastWalletProvider.mockReturnValue('freighter');

        render(
            <WalletConnectWrapper
                walletAddress={null}
                onConnect={mockOnConnect}
                onDisconnect={mockOnDisconnect}
            />
        );

        fireEvent.click(await screen.findByRole('button', { name: /Use a different wallet/i }));

        expect(sessionStorage.getItem('yieldvault_wallet_reconnect_prompt_dismissed')).toBe('1');

        localStorage.clear();
        sessionStorage.clear();
    });

    it('clears reconnect prompt dismissed state on manual disconnect', () => {
        sessionStorage.setItem('yieldvault_wallet_reconnect_prompt_dismissed', '1');

        render(
            <WalletConnectWrapper
                walletAddress="GABC123"
                onConnect={mockOnConnect}
                onDisconnect={mockOnDisconnect}
            />
        );

        const disconnectButton = screen.getByLabelText(/Disconnect Wallet/i);
        fireEvent.click(disconnectButton);

        expect(sessionStorage.getItem('yieldvault_wallet_reconnect_prompt_dismissed')).toBeNull();

        sessionStorage.clear();
    });
});
