import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ThemeToggle from './ThemeToggle';
import { ThemeProvider } from '../context/ThemeContext';


describe('ThemeToggle', () => {
    it('renders the theme toggle button', () => {
        render(
            <ThemeProvider>
                <ThemeToggle />
            </ThemeProvider>
        );
        const button = screen.getByRole('button');
        expect(button).toBeInTheDocument();
    });

    it('changes the theme when clicked', () => {
        render(
            <ThemeProvider>
                <ThemeToggle />
            </ThemeProvider>
        );
        const button = screen.getByRole('button');
        
        // Initial state (likely 'light' due to matchMedia mock)
        expect(button).toHaveAttribute('aria-label', 'Toggle to dark mode');

        // Click to toggle to dark
        fireEvent.click(button);
        expect(button).toHaveAttribute('aria-label', 'Toggle to light mode');

        // Click again to toggle back to light
        fireEvent.click(button);
        expect(button).toHaveAttribute('aria-label', 'Toggle to dark mode');
    });
});
