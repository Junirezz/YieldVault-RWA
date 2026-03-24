import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import VaultDashboard from './VaultDashboard';


// Mock timer for setTimeout in handleTransaction
vi.useFakeTimers();

describe('VaultDashboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the connect overlay when wallet is not connected', () => {
        render(<VaultDashboard walletAddress={null} />);
        expect(screen.getByText(/Wallet Not Connected/i)).toBeInTheDocument();
        expect(screen.getByText(/Please connect your Freighter wallet/i)).toBeInTheDocument();
    });

    it('renders the dashboard when wallet is connected', () => {
        render(<VaultDashboard walletAddress="GABC123" />);
        expect(screen.queryByText(/Wallet Not Connected/i)).not.toBeInTheDocument();
        expect(screen.getByText(/Global RWA Yield Fund/i)).toBeInTheDocument();
        expect(screen.getByText(/Current APY/i)).toBeInTheDocument();
    });

    it('allows switching between deposit and withdraw tabs', () => {
        render(<VaultDashboard walletAddress="GABC123" />);
        
        const depositTab = screen.getByText('Deposit');
        const withdrawTab = screen.getByText('Withdraw');

        fireEvent.click(withdrawTab);
        expect(screen.getByText(/Amount to withdraw/i)).toBeInTheDocument();

        fireEvent.click(depositTab);
        expect(screen.getByText(/Amount to deposit/i)).toBeInTheDocument();
    });

    it('updates the amount input and processes a deposit', async () => {
        render(<VaultDashboard walletAddress="GABC123" />);
        
        const input = screen.getByPlaceholderText('0.00');
        fireEvent.change(input, { target: { value: '100' } });
        expect(input).toHaveValue(100);

        const button = screen.getByText('Approve & Deposit');
        fireEvent.click(button);

        expect(screen.getByText(/Processing Transaction.../i)).toBeInTheDocument();

        // Fast-forward time
        act(() => {
            vi.runAllTimers();
        });

        expect(screen.queryByText(/Processing Transaction.../i)).not.toBeInTheDocument();
        expect(screen.getByText('1350.50')).toBeInTheDocument(); // 1250.50 + 100
    });
});
