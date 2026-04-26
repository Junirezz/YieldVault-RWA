import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ThemeToggle from './ThemeToggle';
import { PreferencesProvider } from "../context/PreferencesContext";


describe('ThemeToggle', () => {
    it('renders the theme toggle button', () => {
        render(
            <PreferencesProvider>
                <ThemeToggle />
            </PreferencesProvider>
        );
        const button = screen.getByRole('button');
        expect(button).toBeInTheDocument();
    });

    it('changes the theme when clicked', () => {
        render(
            <PreferencesProvider>
                <ThemeToggle />
            </PreferencesProvider>
        );
        const button = screen.getByRole('button');

        const initialAriaLabel = button.getAttribute("aria-label");
        expect(initialAriaLabel).toMatch(/Toggle to (dark|light) mode/);

        fireEvent.click(button);
        expect(button.getAttribute("aria-label")).not.toBe(initialAriaLabel);

        fireEvent.click(button);
        expect(button.getAttribute("aria-label")).toBe(initialAriaLabel);
    });
});
