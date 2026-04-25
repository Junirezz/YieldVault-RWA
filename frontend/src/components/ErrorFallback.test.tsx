import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorFallback from './ErrorFallback';
import * as ErrorNavigation from './errorNavigation';

describe('ErrorFallback', () => {
  const mockError = new Error('Test error message');
  const mockResetError = vi.fn();

  it('renders error message', () => {
    render(<ErrorFallback error={mockError} resetError={mockResetError} />);
    
    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByText('Test error message')).toBeDefined();
  });

  it('calls reload when reload button is clicked', () => {
    const reloadSpy = vi.spyOn(ErrorNavigation, 'reloadPage').mockImplementation(() => undefined);

    render(<ErrorFallback error={mockError} resetError={mockResetError} onReload={reloadSpy} />);
    
    const reloadButton = screen.getByText('Reload Page');
    fireEvent.click(reloadButton);
    
    expect(reloadSpy).toHaveBeenCalled();
    reloadSpy.mockRestore();
  });

  it('navigates to home when Go Home button is clicked', () => {
    const assignSpy = vi.spyOn(ErrorNavigation, 'goHome').mockImplementation(() => undefined);

    render(<ErrorFallback error={mockError} resetError={mockResetError} onGoHome={assignSpy} />);
    
    const homeButton = screen.getByText('Go Home');
    fireEvent.click(homeButton);
    
    expect(assignSpy).toHaveBeenCalled();
    assignSpy.mockRestore();
  });
});
