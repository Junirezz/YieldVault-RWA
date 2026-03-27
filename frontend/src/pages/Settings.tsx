import React, { useState } from 'react';
import { usePreferencesContext } from '../context/PreferencesContext';
import type { Theme, Locale, Currency, NotificationPreferences } from '../hooks/usePreferences';

// ─── tiny icon helpers (SVG inline) ───────────────────────────────────────────

const SunIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

const MoonIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const MonitorIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ResetIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
  </svg>
);

// ─── Toggle Switch ─────────────────────────────────────────────────────────────

interface ToggleProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

const Toggle: React.FC<ToggleProps> = ({ id, checked, onChange, disabled }) => (
  <button
    id={id}
    role="switch"
    aria-checked={checked}
    onClick={() => !disabled && onChange(!checked)}
    disabled={disabled}
    style={{
      width: '48px',
      height: '26px',
      borderRadius: '13px',
      background: checked
        ? 'linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))'
        : 'rgba(255,255,255,0.1)',
      border: '1px solid ' + (checked ? 'transparent' : 'var(--border-glass)'),
      position: 'relative',
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      opacity: disabled ? 0.5 : 1,
      flexShrink: 0,
    }}
  >
    <span
      style={{
        position: 'absolute',
        top: '3px',
        left: checked ? '25px' : '3px',
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        transition: 'left 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    />
  </button>
);

// ─── Section wrapper ───────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

const SettingsSection: React.FC<SectionProps> = ({ title, description, icon, children }) => (
  <div
    className="glass-panel"
    style={{ padding: '28px 32px', marginBottom: '20px' }}
  >
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '24px' }}>
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '12px',
          background: 'linear-gradient(135deg, rgba(0,240,255,0.15), rgba(112,0,255,0.15))',
          border: '1px solid rgba(0,240,255,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent-cyan)',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
          {title}
        </h2>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {description}
        </p>
      </div>
    </div>
    {children}
  </div>
);

// ─── Notification row ──────────────────────────────────────────────────────────

interface NotifRowProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

const NotifRow: React.FC<NotifRowProps> = ({ id, label, description, checked, onChange }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '16px',
      padding: '14px 0',
      borderBottom: '1px solid var(--border-glass)',
    }}
  >
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '2px' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{description}</div>
    </div>
    <Toggle id={id} checked={checked} onChange={onChange} />
  </div>
);

// ─── Theme card pill ───────────────────────────────────────────────────────────

interface ThemeCardProps {
  value: Theme;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}

const ThemeCard: React.FC<ThemeCardProps> = ({ value, label, icon, active, onClick }) => (
  <button
    id={`settings-theme-${value}`}
    onClick={onClick}
    aria-pressed={active}
    style={{
      flex: '1 1 0',
      minWidth: '90px',
      padding: '16px 12px',
      borderRadius: '14px',
      border: active
        ? '1.5px solid var(--accent-cyan)'
        : '1.5px solid var(--border-glass)',
      background: active
        ? 'linear-gradient(135deg, rgba(0,240,255,0.12), rgba(112,0,255,0.08))'
        : 'rgba(255,255,255,0.03)',
      color: active ? 'var(--accent-cyan)' : 'var(--text-secondary)',
      cursor: 'pointer',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '10px',
      transition: 'all 0.2s ease',
      boxShadow: active ? '0 0 12px rgba(0,240,255,0.15)' : 'none',
      position: 'relative',
    }}
  >
    {active && (
      <span
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          background: 'var(--accent-cyan)',
          color: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CheckIcon />
      </span>
    )}
    {icon}
    <span style={{ fontSize: '0.82rem', fontWeight: 600, letterSpacing: '0.02em' }}>{label}</span>
  </button>
);

// ─── Styled select ─────────────────────────────────────────────────────────────

interface StyledSelectProps {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}

const StyledSelect: React.FC<StyledSelectProps> = ({ id, value, onChange, options }) => (
  <div style={{ position: 'relative' }}>
    <select
      id={id}
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%',
        background: 'rgba(0,0,0,0.25)',
        border: '1px solid var(--border-glass)',
        borderRadius: '10px',
        color: 'var(--text-primary)',
        padding: '11px 40px 11px 14px',
        fontSize: '0.9rem',
        fontFamily: 'var(--font-sans)',
        outline: 'none',
        cursor: 'pointer',
        appearance: 'none',
        transition: 'border-color 0.2s',
      }}
      onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent-cyan)'; }}
      onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-glass)'; }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value} style={{ background: '#0a0b10' }}>
          {o.label}
        </option>
      ))}
    </select>
    <svg
      style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-secondary)' }}
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </div>
);

// ─── Main Settings page ────────────────────────────────────────────────────────

const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
  { value: 'en-US', label: '🇺🇸  English (US)' },
  { value: 'en-GB', label: '🇬🇧  English (UK)' },
  { value: 'de-DE', label: '🇩🇪  Deutsch (Germany)' },
  { value: 'fr-FR', label: '🇫🇷  Français (France)' },
  { value: 'ja-JP', label: '🇯🇵  日本語 (Japan)' },
  { value: 'zh-CN', label: '🇨🇳  中文 (China)' },
];

const CURRENCY_OPTIONS: { value: Currency; label: string }[] = [
  { value: 'USD', label: 'USD — US Dollar ($)' },
  { value: 'EUR', label: 'EUR — Euro (€)' },
  { value: 'GBP', label: 'GBP — British Pound (£)' },
  { value: 'JPY', label: 'JPY — Japanese Yen (¥)' },
];

const NOTIF_KEYS: { key: keyof NotificationPreferences; label: string; description: string }[] = [
  { key: 'depositAlerts',    label: 'Deposit Alerts',     description: 'Get notified when funds are deposited into your vaults.' },
  { key: 'withdrawalAlerts', label: 'Withdrawal Alerts',  description: 'Get notified when withdrawals are processed.' },
  { key: 'yieldUpdates',     label: 'Yield Updates',      description: 'Daily updates on yield earned across your positions.' },
  { key: 'priceAlerts',      label: 'Price Alerts',       description: 'Price movement alerts for tracked RWA assets.' },
  { key: 'weeklyReport',     label: 'Weekly Report',      description: 'Comprehensive performance summary every Monday.' },
  { key: 'securityAlerts',   label: 'Security Alerts',    description: 'Critical alerts for logins and security events.' },
];

const Settings: React.FC = () => {
  const {
    preferences,
    resolvedTheme,
    setTheme,
    setLocale,
    setCurrency,
    setNotification,
    toggleCompactMode,
    toggleShowBalances,
    resetToDefaults,
  } = usePreferencesContext();

  const [resetConfirm, setResetConfirm] = useState(false);

  const handleReset = () => {
    if (resetConfirm) {
      resetToDefaults();
      setResetConfirm(false);
    } else {
      setResetConfirm(true);
      setTimeout(() => setResetConfirm(false), 3500);
    }
  };

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: '36px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 20px rgba(0,240,255,0.2)',
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
              <path d="M12 2v2m0 16v2M2 12h2m16 0h2" />
            </svg>
          </div>
          <div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
              Settings
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '2px' }}>
              Manage your preferences — they sync across sessions automatically.
            </p>
          </div>
        </div>
      </div>

      {/* ── 1. Appearance ── */}
      <SettingsSection
        title="Appearance"
        description="Customize the look and feel of YieldVault."
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" />
          </svg>
        }
      >
        {/* Theme pills */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>
            Color Theme
          </label>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <ThemeCard value="dark"   label="Dark"   icon={<MoonIcon />}    active={preferences.theme === 'dark'}   onClick={() => setTheme('dark')} />
            <ThemeCard value="light"  label="Light"  icon={<SunIcon />}     active={preferences.theme === 'light'}  onClick={() => setTheme('light')} />
            <ThemeCard value="system" label="System" icon={<MonitorIcon />} active={preferences.theme === 'system'} onClick={() => setTheme('system')} />
          </div>
          {preferences.theme === 'system' && (
            <p style={{ marginTop: '10px', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
              Currently resolving to <strong style={{ color: 'var(--accent-cyan)' }}>{resolvedTheme}</strong> based on your OS preference.
            </p>
          )}
        </div>

        <div style={{ height: '1px', background: 'var(--border-glass)', margin: '16px 0' }} />

        {/* Display toggles */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', padding: '14px 0', borderBottom: '1px solid var(--border-glass)' }}>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '2px' }}>Compact Mode</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Reduce spacing to fit more information on screen.</div>
            </div>
            <Toggle id="settings-compact-mode" checked={preferences.compactMode} onChange={toggleCompactMode} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', padding: '14px 0' }}>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '2px' }}>Show Balances</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Display wallet and vault balances throughout the app.</div>
            </div>
            <Toggle id="settings-show-balances" checked={preferences.showBalances} onChange={toggleShowBalances} />
          </div>
        </div>
      </SettingsSection>

      {/* ── 2. Localisation ── */}
      <SettingsSection
        title="Language & Region"
        description="Set your preferred language and display currency."
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        }
      >
        <div className="settings-locale-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div>
            <label htmlFor="settings-locale" style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
              Language
            </label>
            <StyledSelect
              id="settings-locale"
              value={preferences.locale}
              onChange={v => setLocale(v as Locale)}
              options={LOCALE_OPTIONS}
            />
          </div>
          <div>
            <label htmlFor="settings-currency" style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
              Display Currency
            </label>
            <StyledSelect
              id="settings-currency"
              value={preferences.currency}
              onChange={v => setCurrency(v as Currency)}
              options={CURRENCY_OPTIONS}
            />
          </div>
        </div>
        <p style={{ marginTop: '14px', fontSize: '0.8rem', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          Locale affects date, time, and number formatting. Currency affects how values are displayed (conversion rates not applied).
        </p>
      </SettingsSection>

      {/* ── 3. Notifications ── */}
      <SettingsSection
        title="Notifications"
        description="Choose which events you want to be notified about."
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {NOTIF_KEYS.map(({ key, label, description }) => (
            <NotifRow
              key={key}
              id={`settings-notif-${key}`}
              label={label}
              description={description}
              checked={preferences.notifications[key]}
              onChange={v => setNotification(key, v)}
            />
          ))}
        </div>
        <p style={{ marginTop: '14px', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
          In-app notifications only. Email notifications will be configurable once account linking is available.
        </p>
      </SettingsSection>

      {/* ── Reset ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', paddingBottom: '40px' }}>
        <button
          id="settings-reset-btn"
          onClick={handleReset}
          className="btn btn-outline"
          style={{
            gap: '8px',
            borderColor: resetConfirm ? 'rgba(255,100,100,0.5)' : 'var(--border-glass)',
            color: resetConfirm ? '#ff6b6b' : 'var(--text-secondary)',
            transition: 'all 0.2s ease',
          }}
        >
          <ResetIcon />
          {resetConfirm ? 'Tap again to confirm reset' : 'Reset to Defaults'}
        </button>
      </div>
    </div>
  );
};

export default Settings;
