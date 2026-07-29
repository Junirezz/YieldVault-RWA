/**
 * Tests for TransactionConfirmationModal component.
 * Covers accessibility, interactions, warning display, and focus management.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TransactionConfirmationModal } from './TransactionConfirmationModal';
import type { TransactionSummary } from '../types/transaction';

describe('TransactionConfirmationModal', () => {
  const mockSummary: TransactionSummary = {
    amount: '100.00 USDC',
    asset: 'USDC',
    network: 'Testnet',
    estimatedFee: '0.000100 XLM',
    contractAddress: 'CBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    contractName: 'YieldVault',
    actionType: 'deposit',
    isUnusualAmount: false,
    isUnusualFee: false,
    isUnknownContract: false,
  };

  const defaultProps = {
    isOpen: true,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    summary: mockSummary,
  };

  describe('Rendering', () => {
    it('renders with isOpen true', () => {
      render(<TransactionConfirmationModal {...defaultProps} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('does not render when isOpen is false', () => {
      render(<TransactionConfirmationModal {...defaultProps} isOpen={false} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('displays action-specific title (Confirm Deposit)', () => {
      render(<TransactionConfirmationModal {...defaultProps} />);
      expect(screen.getByText('Confirm deposit')).toBeInTheDocument();
    });

    it('displays action-specific title (Confirm Withdrawal)', () => {
      const withdrawProps = {
        ...defaultProps,
        summary: { ...mockSummary, actionType: 'withdraw' },
      };
      render(<TransactionConfirmationModal {...withdrawProps} />);
      expect(screen.getByText('Confirm withdraw')).toBeInTheDocument();
    });

    it('displays all transaction details', () => {
      render(<TransactionConfirmationModal {...defaultProps} />);
      expect(screen.getByText('100.00 USDC')).toBeInTheDocument();
      expect(screen.getByText('USDC')).toBeInTheDocument();
      expect(screen.getByText('Testnet')).toBeInTheDocument();
      expect(screen.getByText('0.000100 XLM')).toBeInTheDocument();
      expect(screen.getByText('YieldVault')).toBeInTheDocument();
    });

    it('displays contract address in monospace font', () => {
      render(<TransactionConfirmationModal {...defaultProps} />);
      const addressText = screen.getByText(mockSummary.contractAddress);
      const styledParent = addressText.parentElement;
      expect(styledParent?.style.fontFamily).toMatch(/monospace/i);
      expect(addressText.parentElement?.getAttribute("style") ?? "").toMatch(/monospace/i);
    });
  });

  describe('Unusual Value Warnings', () => {
    it('does not show warnings when all values are normal', () => {
      render(<TransactionConfirmationModal {...defaultProps} />);
      expect(screen.queryByText('Review Transaction Details')).not.toBeInTheDocument();
    });

    it('shows warning when amount is unusual', () => {
      const unusualProps = {
        ...defaultProps,
        summary: { ...mockSummary, isUnusualAmount: true },
      };
      render(<TransactionConfirmationModal {...unusualProps} />);
      expect(screen.getByText('Review Transaction Details')).toBeInTheDocument();
      expect(screen.getByText('This amount is unusually large.')).toBeInTheDocument();
    });

    it('shows warning when fee is unusual', () => {
      const unusualProps = {
        ...defaultProps,
        summary: { ...mockSummary, isUnusualFee: true },
      };
      render(<TransactionConfirmationModal {...unusualProps} />);
      expect(screen.getByText('This fee is higher than usual.')).toBeInTheDocument();
    });

    it('shows warning when contract is unknown', () => {
      const unknownProps = {
        ...defaultProps,
        summary: { ...mockSummary, isUnknownContract: true, contractName: null },
      };
      render(<TransactionConfirmationModal {...unknownProps} />);
      expect(screen.getByText('This contract address is not in the verified list.')).toBeInTheDocument();
    });

    it('shows multiple warnings when multiple conditions are true', () => {
      const multiWarningProps = {
        ...defaultProps,
        summary: {
          ...mockSummary,
          isUnusualAmount: true,
          isUnusualFee: true,
          isUnknownContract: true,
          contractName: null,
        },
      };
      render(<TransactionConfirmationModal {...multiWarningProps} />);
      expect(screen.getByText('This amount is unusually large.')).toBeInTheDocument();
      expect(screen.getByText('This fee is higher than usual.')).toBeInTheDocument();
      expect(screen.getByText('This contract address is not in the verified list.')).toBeInTheDocument();
    });

    it('highlights unusual amount value in warning color', () => {
      const unusualProps = {
        ...defaultProps,
        summary: { ...mockSummary, isUnusualAmount: true },
      };
      render(<TransactionConfirmationModal {...unusualProps} />);
      const amountValue = screen.getByText('100.00 USDC');
      expect(amountValue.getAttribute('style')).toContain('var(--text-warning)');
    });

    it('highlights unusual fee value in warning color', () => {
      const unusualProps = {
        ...defaultProps,
        summary: { ...mockSummary, isUnusualFee: true },
      };
      render(<TransactionConfirmationModal {...unusualProps} />);
      const feeValue = screen.getByText('0.000100 XLM');
      expect(feeValue.getAttribute('style')).toContain('var(--text-warning)');
    });
  });

  describe('Button Labels and States', () => {
    it('displays "Confirm" button when no warnings', () => {
      render(<TransactionConfirmationModal {...defaultProps} />);
      expect(screen.getByRole('button', { name: /Confirm/ })).toBeInTheDocument();
    });

    it('displays "Confirm Anyway" button when warnings exist', () => {
      const warningProps = {
        ...defaultProps,
        summary: { ...mockSummary, isUnusualAmount: true },
      };
      render(<TransactionConfirmationModal {...warningProps} />);
      expect(screen.getByRole('button', { name: /Confirm Anyway/ })).toBeInTheDocument();
    });

    it('disables confirm button when isLoading is true', () => {
      render(<TransactionConfirmationModal {...defaultProps} isLoading={true} />);
      const confirmBtn = screen.getByRole('button', { name: /Signing/ });
      expect(confirmBtn).toBeDisabled();
    });

    it('disables cancel button when isLoading is true', () => {
      render(<TransactionConfirmationModal {...defaultProps} isLoading={true} />);
      const cancelBtn = screen.getByRole('button', { name: /Cancel/ });
      expect(cancelBtn).toBeDisabled();
    });

    it('shows loading spinner and "Signing..." text when isLoading is true', () => {
      render(<TransactionConfirmationModal {...defaultProps} isLoading={true} />);
      expect(screen.getByText('Signing...')).toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('calls onConfirm when Confirm button is clicked', async () => {
      const onConfirm = vi.fn();
      render(<TransactionConfirmationModal {...defaultProps} onConfirm={onConfirm} />);
      const confirmBtn = screen.getByRole('button', { name: /Confirm/ });
      fireEvent.click(confirmBtn);
      expect(onConfirm).toHaveBeenCalledOnce();
    });

    it('calls onCancel when Cancel button is clicked', async () => {
      const onCancel = vi.fn();
      render(<TransactionConfirmationModal {...defaultProps} onCancel={onCancel} />);
      const cancelBtn = screen.getByRole('button', { name: /Cancel/ });
      fireEvent.click(cancelBtn);
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('calls onCancel when Escape key is pressed', async () => {
      const onCancel = vi.fn();
      render(<TransactionConfirmationModal {...defaultProps} onCancel={onCancel} />);
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    });

    it('does not dismiss on backdrop click (security requirement)', () => {
      const onCancel = vi.fn();
      render(<TransactionConfirmationModal {...defaultProps} onCancel={onCancel} />);
      const backdrop = screen.getByRole('dialog').parentElement;
      if (backdrop) {
        fireEvent.click(backdrop);
      }
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe('Accessibility', () => {
    it('has role="dialog"', () => {
      render(<TransactionConfirmationModal {...defaultProps} />);
      expect(screen.getByRole('dialog')).toHaveAttribute('role', 'dialog');
    });

    it('has aria-modal="true"', () => {
      render(<TransactionConfirmationModal {...defaultProps} />);
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    it('has aria-labelledby pointing to title', () => {
      render(<TransactionConfirmationModal {...defaultProps} />);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-labelledby');
    });

    it('has aria-describedby pointing to risk summary', () => {
      render(<TransactionConfirmationModal {...defaultProps} />);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-describedby');
    });

    it('displays risk summary with important message', () => {
      render(<TransactionConfirmationModal {...defaultProps} />);
      expect(screen.getByText(/This transaction cannot be reversed once signed/)).toBeInTheDocument();
    });

    it('allows copying contract address', async () => {
      // Mock clipboard API
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn(() => Promise.resolve()),
        },
      });

      render(<TransactionConfirmationModal {...defaultProps} />);
      const copyBtn = screen.getByRole('button', { name: /Copy contract address/ });
      fireEvent.click(copyBtn);
      
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockSummary.contractAddress);
    });

    it('announces copy action with aria-label', () => {
      render(<TransactionConfirmationModal {...defaultProps} />);
      const copyBtn = screen.getByRole('button', { name: /Copy contract address/ });
      expect(copyBtn).toHaveAttribute('aria-label', 'Copy contract address to clipboard');
    });
  });

  describe('Focus Management', () => {
    it('traps focus within modal', async () => {
      render(<TransactionConfirmationModal {...defaultProps} />);
      
      const dialog = screen.getByRole('dialog');
      const focusableElements = dialog.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      
      // Should have at least 2 buttons (Cancel and Confirm)
      expect(focusableElements.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Contract Address Display', () => {
    it('displays contract name when available', () => {
      render(<TransactionConfirmationModal {...defaultProps} />);
      expect(screen.getByText('YieldVault')).toBeInTheDocument();
    });

    it('displays full contract address', () => {
      render(<TransactionConfirmationModal {...defaultProps} />);
      expect(screen.getByText(mockSummary.contractAddress)).toBeInTheDocument();
    });

    it('does not truncate contract address', () => {
      render(<TransactionConfirmationModal {...defaultProps} />);
      const address = screen.getByText(mockSummary.contractAddress);
      expect(address.textContent).toBe(mockSummary.contractAddress);
      expect(address.textContent).not.toContain('...');
    });

    it('shows "Not in verified list" when contract is unknown', () => {
      const unknownProps = {
        ...defaultProps,
        summary: { ...mockSummary, isUnknownContract: true, contractName: null },
      };
      render(<TransactionConfirmationModal {...unknownProps} />);
      expect(screen.getByText('Not in verified list')).toBeInTheDocument();
    });
  });
});
