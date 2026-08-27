# Contract Performance Regression Thresholds (Issue #1235)

Nightly benchmarks measure Soroban **host** CPU instructions and memory bytes
for core vault operations. This repo is Stellar/Soroban, so the equivalent of
Foundry `forge test --gas-report` + Anvil is the Soroban test `Env` budget
meter plus a scheduled GitHub Actions workflow.

Numbers are **relative across commits**, not production WASM gas. Host metering
underestimates VM instantiation.

## Operations

| Op | What is measured |
| --- | --- |
| `deposit` | Subsequent deposit (after a warm-up deposit) |
| `withdraw` | Partial share redemption |
| `invest` | Idle → strategy allocation |
| `switch_strategy` | `set_strategy` between two Benji strategy instances (v1 ↔ v2) |

Each op is reported once per strategy version so the nightly issue can compare
implementations.

## Thresholds

Baseline: `contracts/vault/benches/baseline.json`

| Field | Value |
| --- | --- |
| `regression_threshold_pct` | **15** |
| Fail CI | any op's CPU or memory **> baseline × 1.15** |
| Compare | max(v1, v2) for that op vs the baseline entry |

If a real, accepted optimisation or feature increases cost, update the baseline
in the same PR and explain why in the nightly issue / PR body.

## How to run

```bash
bash contracts/vault/scripts/benchmark.sh
```

The script:

1. Runs `cargo test -p vault --test benchmarks -- --nocapture`
2. Parses `BENCH op=... cpu=... mem=...` lines
3. Writes `benchmark-report.md` and `benchmark-results.json`
4. Exits non-zero on a regression against `baseline.json`

Nightly: `.github/workflows/nightly-benchmarks.yml` (02:00 UTC) posts the
report to a GitHub Issue labeled `nightly-benchmark`.
