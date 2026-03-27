import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WalletConnect from './WalletConnect';
import * as freighter from '@stellar/freighter-api';
import { ToastProvider } from '../context/ToastContext';


// Mock freighter-api
vi.mock('@stellar/freighter-api', () => ({
    isAllowed: vi.fn(),
    setAllowed: vi.fn(),
    getAddress: vi.fn(),
}));

const mockedFreighter = vi.mocked(freighter);

const WalletConnectWrapper: React.FC<ComponentProps<typeof WalletConnect>> = (props) => (
    <ToastProvider>
        <WalletConnect {...props} />
    </ToastProvider>
);

describe('WalletConnect', () => {
    const mockOnConnect = vi.fn();
    const mockOnDisconnect = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    afterEach(() => {
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

    it('shows the formatted address when connected', () => {
        const fullAddress = 'GABC1234567890123456789012345678901234567890123456789012';
        const expectedAddress = 'GABC1...9012';
        render(
            <WalletConnectWrapper 
                walletAddress={fullAddress} 
                onConnect={mockOnConnect} 
                onDisconnect={mockOnDisconnect} 
            />
        );

        expect(screen.getByText(expectedAddress)).toBeInTheDocument();
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
        // Helper to flush all pending promises
        const flushPromises = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

        vi.useFakeTimers({ shouldAdvanceTime: false });
        mockedFreighter.isAllowed
            .mockResolvedValueOnce({ isAllowed: true })
            .mockResolvedValueOnce({ isAllowed: false });
        mockedFreighter.getAddress.mockResolvedValue({ address: 'GABC123' });

        render(
            <WalletConnectWrapper
                walletAddress="GABC123"
                onConnect={mockOnConnect}
                onDisconnect={mockOnDisconnect}
            />
        );

        // Advance timers by 0 to flush the initial synchronous setup,
        // then flush microtasks from the async calls
        vi.advanceTimersByTime(0);
        await vi.advanceTimersByTimeAsync(0);

        expect(mockOnConnect).toHaveBeenCalledWith('GABC123');

        // Advance past the 10s polling interval
        await vi.advanceTimersByTimeAsync(10001);

        expect(mockOnDisconnect).toHaveBeenCalled();
    }, 20000);
});
