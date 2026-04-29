import React from "react";
import { Activity, LineChart } from "../components/icons";
import ApiStatusBanner from "../components/ApiStatusBanner";
import PageHeader from "../components/PageHeader";
import { useVault } from "../context/VaultContext";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/ui/EmptyState";
import { useNavigate } from "react-router-dom";

const Analytics: React.FC = () => {
    const { formattedTvl, tvl, summary, error, isLoading } = useVault();
    const navigate = useNavigate();

    /**
     * Determine whether there is meaningful data to display.
     * We consider the analytics page "empty" when loading has finished and
     * the vault has no TVL (i.e. no historical activity has been recorded yet).
     */
    const hasData = isLoading || tvl > 0;

    return (
        <div className="glass-panel" style={{ padding: '32px' }}>
            {error && <ApiStatusBanner error={error} />}

            <PageHeader
                title={<span className="text-gradient">Project Analytics</span>}
                description="Historical performance and pool health metrics."
                breadcrumbs={[
                    { label: "Home", href: "/" },
                    { label: "Analytics" },
                ]}
                statusChips={[
                    {
                        label: isLoading ? "Syncing" : "Live",
                        variant: isLoading ? "warning" : "success",
                    },
                ]}
            />

            {hasData ? (
                <>
                    <div className="flex gap-lg" style={{ flexWrap: 'wrap' }}>
                        <div className="glass-panel" style={{ flex: '1 1 300px', padding: '24px', background: 'var(--bg-muted)' }}>
                            <div className="text-body-sm" style={{ color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                                Total Value Locked
                                <span style={{ color: 'var(--accent-cyan)', fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Activity size={10} className={isLoading ? "animate-pulse" : undefined} />
                                    {isLoading ? "SYNCING" : "LIVE"}
                                </span>
                            </div>
                            <div style={{ fontSize: 'var(--text-4xl)', fontWeight: 'var(--font-semibold)' }}>
                                {isLoading ? <Skeleton width="180px" height="2.5rem" /> : formattedTvl}
                            </div>
                            <div className="text-caption" style={{ color: 'var(--accent-cyan)', marginTop: '8px' }}>+{summary.monthlyGrowthPct}% this month</div>
                        </div>
                        <div className="glass-panel" style={{ flex: '1 1 300px', padding: '24px', background: 'var(--bg-muted)' }}>
                            <div className="text-body-sm" style={{ color: 'var(--text-secondary)' }}>Vault Participants</div>
                            <div style={{ fontSize: 'var(--text-4xl)', fontWeight: 'var(--font-semibold)' }}>
                                {isLoading ? <Skeleton width="120px" height="2.5rem" /> : summary.participantCount.toLocaleString('en-US')}
                            </div>
                            <div className="text-caption" style={{ color: 'var(--accent-cyan)', marginTop: '8px' }}>+82 new users</div>
                        </div>
                        <div className="glass-panel" style={{ flex: '1 1 300px', padding: '24px', background: 'var(--bg-muted)' }}>
                            <div className="text-body-sm" style={{ color: 'var(--text-secondary)' }}>Strategy Stability</div>
                            <div style={{ fontSize: 'var(--text-4xl)', fontWeight: 'var(--font-semibold)' }}>
                                {isLoading ? <Skeleton width="100px" height="2.5rem" /> : `${summary.strategyStabilityPct}%`}
                            </div>
                            <div className="text-caption" style={{ color: 'var(--accent-cyan)', marginTop: '8px' }}>Tracking Sovereign Bonds</div>
                        </div>
                    </div>

                    <EmptyState
                        variant="minimal"
                        title="Advanced Analytics Coming Soon"
                        description="We're currently indexing historical data to provide you with deeper insights into pool health and asset stability."
                        icon={<Activity size={32} />}
                    />
                </>
            ) : (
                /* Empty state: loading done, no TVL / no historical data */
                <EmptyState
                    title="No data to display."
                    description="Performance metrics will appear here once your assets start generating yield."
                    icon={<LineChart />}
                    actionLabel="Deposit Now"
                    onAction={() => navigate("/")}
                />
            )}
        </div>
    );
};

export default Analytics;
