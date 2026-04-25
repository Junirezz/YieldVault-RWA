import React from 'react';
import { Sun, Moon } from './icons';
import { usePreferencesContext } from "../context/PreferencesContext";
import { useTranslation } from '../i18n';

const ThemeToggle: React.FC = () => {
    const { resolvedTheme, setTheme } = usePreferencesContext();
    const { t } = useTranslation();

    const isLight = resolvedTheme === "light";
    const toggleTheme = () => {
        setTheme(isLight ? "dark" : "light");
    };

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
            aria-label={
                isLight
                    ? t("theme.toggleToDark")
                    : t("theme.toggleToLight")
            }
        >
            <div style={{ position: 'relative', width: '20px', height: '20px' }}>
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    transform: isLight ? 'rotate(0deg) scale(1)' : 'rotate(90deg) scale(0)',
                    opacity: isLight ? 1 : 0,
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                }}>
                    <Sun size={20} />
                </div>
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    transform: !isLight ? 'rotate(0deg) scale(1)' : 'rotate(-90deg) scale(0)',
                    opacity: !isLight ? 1 : 0,
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                }}>
                    <Moon size={20} />
                </div>
            </div>
        </button>
    );
};

export default ThemeToggle;
