import { Activity, BarChart3, Landmark, PieChart } from 'lucide-react';

const metricCards = [
  {
    icon: Landmark,
    label: 'Total Value Locked',
    value: '$12,450,800',
    detail: 'Across sovereign debt allocations and daily yield accrual.',
  },
  {
    icon: Activity,
    label: 'Current APY',
    value: '8.45%',
    detail: 'Net blended return from the active BENJI Strategy sleeve.',
  },
  {
    icon: PieChart,
    label: 'Vault Exchange Rate',
    value: '1 yvUSDC = 1.084 USDC',
    detail: 'Share price reflects auto-compounded yield in the live vault.',
  },
  {
    icon: BarChart3,
    label: 'Network Fee',
    value: '~0.00001 XLM',
    detail: 'Estimated Stellar submission cost for standard user actions.',
  },
];

function AnalyticsPage() {
  return (
    <section className="flex flex-col gap-lg">
      <header className="glass-panel analytics-header">
        <span className="tag cyan" style={{ marginBottom: '16px' }}>
          Live Analytics
        </span>
        <h2 style={{ fontSize: '2.4rem', marginBottom: '12px' }}>Project Analytics</h2>
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: '1rem',
            maxWidth: '720px',
          }}
        >
          Track the vault&apos;s live performance, strategy efficiency, and user-facing settlement
          costs from a single monitoring view.
        </p>
      </header>

      <div className="analytics-metrics-grid">
        {metricCards.map(({ icon: Icon, label, value, detail }) => (
          <article key={label} className="glass-panel" style={{ padding: '24px' }}>
            <div
              className="flex items-center gap-sm"
              style={{ color: 'var(--accent-cyan)', marginBottom: '18px' }}
            >
              <Icon size={18} />
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{label}</span>
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.8rem',
                fontWeight: 700,
                marginBottom: '10px',
              }}
            >
              {value}
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem' }}>{detail}</p>
          </article>
        ))}
      </div>

      <div className="glass-panel" style={{ padding: '28px' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: '12px' }}>BENJI Strategy</h3>
        <p style={{ color: 'var(--text-secondary)', maxWidth: '760px' }}>
          Capital is routed into tokenized sovereign debt exposure with daily reinvestment, giving
          depositors a stable yield profile and a steadily appreciating vault share price.
        </p>
      </div>
    </section>
  );
}

export default AnalyticsPage;
