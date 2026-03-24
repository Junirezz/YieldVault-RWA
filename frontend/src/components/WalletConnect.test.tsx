import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import WalletConnect from './WalletConnect';
import * as freighter from '@stellar/freighter-api';


// Mock freighter-api
vi.mock('@stellar/freighter-api', () => ({
    isAllowed: vi.fn(),
    setAllowed: vi.fn(),
    getAddress: vi.fn(),
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    },
}));

describe('WalletConnect', () => {
    const mockOnConnect = vi.fn();
    const mockOnDisconnect = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the connect button when no wallet is connected', async () => {
        (freighter.isAllowed as any).mockResolvedValue(false);
        render(
            <WalletConnect 
                walletAddress={null} 
                onConnect={mockOnConnect} 
                onDisconnect={mockOnDisconnect} 
            />
        );

        expect(screen.getByText(/Connect Freighter/i)).toBeInTheDocument();
    });

    it('calls onConnect when manually connected via button', async () => {
        (freighter.isAllowed as any).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        (freighter.setAllowed as any).mockResolvedValue(true);
        (freighter.getAddress as any).mockResolvedValue({ address: 'GABC123' });

        render(
            <WalletConnect 
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
            <WalletConnect 
                walletAddress={fullAddress} 
                onConnect={mockOnConnect} 
                onDisconnect={mockOnDisconnect} 
            />
        );

        expect(screen.getByText(expectedAddress)).toBeInTheDocument();
    });

    it('calls onDisconnect when the disconnect button is clicked', () => {
        render(
            <WalletConnect 
                walletAddress="GABC123...9012" 
                onConnect={mockOnConnect} 
                onDisconnect={mockOnDisconnect} 
            />
        );

        const disconnectButton = screen.getByLabelText(/Disconnect Wallet/i);
        fireEvent.click(disconnectButton);

        expect(mockOnDisconnect).toHaveBeenCalled();
    });
});
