import React from "react";
import { Activity, LineChart } from "../components/icons";
import { useTranslation } from "../i18n";
import ApiStatusBanner from "../components/ApiStatusBanner";
import PageHeader from "../components/PageHeader";
import { useVault } from "../context/VaultContext";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/ui/EmptyState";
import APYTrendChart from "../components/APYTrendChart";
import { useNavigate } from "react-router-dom";
import { triggerDepositIntent } from "../lib/vaultIntentActions";
import RefreshControl from "../components/RefreshControl";
import { usePolling } from "../hooks/usePolling";
import { useStaleIndicator } from "../hooks/useStaleIndicator";

const Analytics: React.FC = () => {
    const { formattedTvl, tvl, summary, error, isLoading, lastUpdate, refresh } = useVault();
    const { t } = useTranslation();
    const polling = usePolling(refresh, { interval: 30000, pauseOnHidden: true, pauseOnOffline: true });
    const { isStale, ageText } = useStaleIndicator(lastUpdate);
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
                title={<span className="text-gradient">{t("analytics.staticTitle")}</span>}
                description={t("analytics.staticDescription")}
                breadcrumbs={[
                    { label: t("analytics.homeLabel"), href: "/" },
                    { label: t("nav.analytics") },
                ]}
                statusChips={[
                    {
                        label: isLoading ? t("analytics.syncingLabel") : t("analytics.liveLabel"),
                        variant: isLoading ? "warning" : "success",
                    },
                ]}
            />

            {hasData ? (
                <>
                    {/* Per-widget refresh control + stale indicator for analytics stats */}
                    <div style={{ marginBottom: "16px" }}>
                        <RefreshControl
                            isPolling={polling.isPolling}
                            isPaused={polling.isPaused}
                            pauseReason={polling.pauseReason}
                            onPause={polling.pause}
                            onResume={polling.resume}
                            onRefresh={polling.forceRefresh}
                            isRefetching={isLoading}
                            lastUpdated={lastUpdate}
                        />
                        {isStale && ageText && (
                            <div
                                role="status"
                                aria-live="polite"
                                style={{
                                    marginTop: "6px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    fontSize: "0.75rem",
                                    color: "var(--text-warning, #f59e0b)",
                                }}
                            >
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-warning, #f59e0b)", flexShrink: 0 }} />
                                Data may be stale · {ageText}
                            </div>
                        )}
                    </div>
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

                    <div style={{ marginTop: "32px" }}>
                        <APYTrendChart />
                    </div>
                </>
            ) : (
                /* Empty state: loading done, no TVL / no historical data */
                <EmptyState
                    kind="no-data"
                    title={t("analytics.emptyTitle")}
                    description={t("analytics.emptyDesc")}
                    icon={<LineChart />}
                    actionLabel={t("analytics.depositNow")}
                    onAction={() => triggerDepositIntent(navigate, null)}
                />
            )}
        </div>
    );
};

export default Analytics;
