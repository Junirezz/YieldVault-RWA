import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorFallback from './ErrorFallback';

describe('ErrorFallback', () => {
  const mockError = new Error('Test error message');
  const mockResetError = vi.fn();

  it('renders error message', () => {
    render(<ErrorFallback error={mockError} resetError={mockResetError} />);
    
    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByText('Test error message')).toBeDefined();
  });

  it('calls reload when reload button is clicked', () => {
    const originalLocation = window.location;
    // @ts-ignore
    delete window.location;
    window.location = { ...originalLocation, reload: vi.fn() };

    render(<ErrorFallback error={mockError} resetError={mockResetError} />);
    
    const reloadButton = screen.getByText('Reload Page');
    fireEvent.click(reloadButton);
    
    expect(window.location.reload).toHaveBeenCalled();

    window.location = originalLocation;
  });

  it('navigates to home when Go Home button is clicked', () => {
    const originalLocation = window.location;
    // @ts-ignore
    delete window.location;
    window.location = { ...originalLocation, href: '' };

    render(<ErrorFallback error={mockError} resetError={mockResetError} />);
    
    const homeButton = screen.getByText('Go Home');
    fireEvent.click(homeButton);
    
    expect(window.location.href).toBe('/');

    window.location = originalLocation;
  });
});
