# Feature Flags (Vite)

This app uses environment-based flags to toggle frontend features safely. We use a **fail-closed** approach: if a variable is not exactly `"true"`, the feature is treated as disabled.

> [!IMPORTANT]
> Vite injects `import.meta.env` values at build/dev-server startup time.
> Restart the dev server after changing `.env` values so flag updates take effect.

## Registered Flags

| Key | Env Var | Notes |
| :--- | :--- | :--- |
| `ANALYTICS_PAGE` | `VITE_FF_ANALYTICS_PAGE` | Gates the analytics route until rollout is approved. |

## How to Add a Flag

1. Register the key in `FLAG_KEYS` in `src/context/FeatureFlagContext.tsx`.
2. Add the env variable to `.env.example` (`VITE_FF_<FLAG_KEY>`).
3. Use `useFeatureFlag` (evaluation utility) or `<FeatureGate>` where needed.

## Usage Patterns

### 1) Component wrapper (preferred for full sections/routes)

```tsx
<FeatureGate flag="ANALYTICS_PAGE" fallback={<Skeleton />}>
  <AnalyticsDashboard />
</FeatureGate>
```

### 2) Evaluation utility hook (preferred for inline conditions)

```tsx
const analyticsEnabled = useFeatureFlag("ANALYTICS_PAGE");

return analyticsEnabled ? <AnalyticsDashboard /> : <EmptyState />;
```
