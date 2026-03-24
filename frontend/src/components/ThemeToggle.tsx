import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

const ThemeToggle: React.FC = () => {
    const { theme, toggleTheme } = useTheme();

    return (
        <button
            onClick={toggleTheme}
            className="btn-outline"
            style={{
                width: '40px',
                height: '40px',
                padding: '0',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-glass)',
                color: 'var(--text-primary)',
                boxShadow: 'var(--shadow-glass)'
            }}
            aria-label={`Toggle to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
            <div style={{ position: 'relative', width: '20px', height: '20px' }}>
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    transform: theme === 'light' ? 'rotate(0deg) scale(1)' : 'rotate(90deg) scale(0)',
                    opacity: theme === 'light' ? 1 : 0,
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                }}>
                    <Sun size={20} />
                </div>
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    transform: theme === 'dark' ? 'rotate(0deg) scale(1)' : 'rotate(-90deg) scale(0)',
                    opacity: theme === 'dark' ? 1 : 0,
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                }}>
                    <Moon size={20} />
                </div>
            </div>
        </button>
    );
};

export default ThemeToggle;
