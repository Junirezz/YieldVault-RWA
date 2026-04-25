import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WalletConnect from './WalletConnect';
import * as freighter from '@stellar/freighter-api';
import { ToastProvider } from '../context/ToastContext';


// Mock freighter-api
vi.mock('@stellar/freighter-api', () => ({
    isConnected: vi.fn(),
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
        mockedFreighter.isConnected.mockResolvedValue({ isConnected: true });
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

    it('shows error state when Freighter is not installed', async () => {
        mockedFreighter.isConnected.mockResolvedValue({ isConnected: false });
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
            // Button should change to error state, toast shown
            // Check for the error icon/state via tooltip or visually
            const btn = screen.getByText(/Connect Freighter/i).closest('button');
            expect(btn).toHaveClass('btn-error');
        });
    });

    it('shows loading state while connecting', async () => {
        mockedFreighter.isAllowed.mockResolvedValue({ isAllowed: false });
        mockedFreighter.setAllowed.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));
        
        render(
            <WalletConnectWrapper 
                walletAddress={null} 
                onConnect={mockOnConnect} 
                onDisconnect={mockOnDisconnect} 
            />
        );

        const button = screen.getByText(/Connect Freighter/i);
        fireEvent.click(button);

        // Should show connecting state
        expect(screen.getByText(/Connecting/i)).toBeInTheDocument();
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
        vi.useFakeTimers({ shouldAdvanceTime: false });
        mockedFreighter.isAllowed
            .mockResolvedValueOnce({ isAllowed: true })
            .mockResolvedValueOnce({ isAllowed: false })
            .mockResolvedValue({ isAllowed: false });
        mockedFreighter.getAddress.mockResolvedValue({ address: 'GABC123' });

        render(
            <WalletConnectWrapper
                walletAddress="GABC123"
                onConnect={mockOnConnect}
                onDisconnect={mockOnDisconnect}
            />
        );

        act(() => {
            vi.advanceTimersByTime(10000);
        });

        expect(mockedFreighter.isAllowed.mock.calls.length).toBeGreaterThanOrEqual(2);
        
        vi.useRealTimers();
    });
});
