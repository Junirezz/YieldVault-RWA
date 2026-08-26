#!/usr/bin/env bash
# Nightly / local contract benchmarks (Issue #1235).
# Parses BENCH lines from the Foundry-style vault gas report (Soroban host budget).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

BASELINE="${BASELINE:-contracts/vault/benches/baseline.json}"
REPORT_MD="${REPORT_MD:-benchmark-report.md}"
REPORT_JSON="${REPORT_JSON:-benchmark-results.json}"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

echo "==> Running vault operation benchmarks"
cargo test -p vault --test benchmarks --locked -- --nocapture 2>&1 | tee "$LOG"

python3 - "$LOG" "$BASELINE" "$REPORT_MD" "$REPORT_JSON" <<'PY'
import json, re, sys, datetime, collections

log_path, baseline_path, report_md, report_json = sys.argv[1:5]
text = open(log_path, encoding="utf-8", errors="replace").read()
rows = []
for op, strategy, cpu, mem in re.findall(
    r"BENCH op=(\S+) strategy=(\S+) cpu=(\d+) mem=(\d+)", text
):
    rows.append(
        {
            "op": op,
            "strategy": strategy,
            "cpu": int(cpu),
            "mem": int(mem),
        }
    )

if not rows:
    print("No BENCH lines found in benchmark output", file=sys.stderr)
    sys.exit(2)

baseline = json.load(open(baseline_path, encoding="utf-8"))
threshold = float(baseline.get("regression_threshold_pct", 15))
ops_base = baseline["ops"]

by_op = collections.defaultdict(list)
for row in rows:
    by_op[row["op"]].append(row)

summary = []
failed = []
for op, samples in sorted(by_op.items()):
    max_cpu = max(s["cpu"] for s in samples)
    max_mem = max(s["mem"] for s in samples)
    base = ops_base.get(op, {})
    base_cpu = int(base.get("cpu", 0))
    base_mem = int(base.get("mem", 0))
    cpu_limit = int(base_cpu * (100 + threshold) / 100) if base_cpu else None
    mem_limit = int(base_mem * (100 + threshold) / 100) if base_mem else None
    cpu_ok = cpu_limit is None or max_cpu <= cpu_limit
    mem_ok = mem_limit is None or max_mem <= mem_limit
    entry = {
        "op": op,
        "max_cpu": max_cpu,
        "max_mem": max_mem,
        "baseline_cpu": base_cpu,
        "baseline_mem": base_mem,
        "cpu_limit": cpu_limit,
        "mem_limit": mem_limit,
        "cpu_ok": cpu_ok,
        "mem_ok": mem_ok,
        "samples": samples,
    }
    summary.append(entry)
    if not cpu_ok:
        failed.append(f"{op} cpu {max_cpu} > limit {cpu_limit}")
    if not mem_ok:
        failed.append(f"{op} mem {max_mem} > limit {mem_limit}")

payload = {
    "generated_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    "regression_threshold_pct": threshold,
    "results": summary,
}
json.dump(payload, open(report_json, "w", encoding="utf-8"), indent=2)

lines = [
    f"# Nightly contract benchmarks ({payload['generated_at']})",
    "",
    "Soroban host CPU / memory for core vault operations.",
    f"Regression threshold: **{threshold:.0f}%** over `{baseline_path}`.",
    "",
    "| Op | Max CPU | CPU baseline | CPU limit | Max mem | Mem baseline | Mem limit | Status |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
]
for e in summary:
    status = "✅" if e["cpu_ok"] and e["mem_ok"] else "❌"
    lines.append(
        f"| `{e['op']}` | {e['max_cpu']} | {e['baseline_cpu']} | {e['cpu_limit']} | "
        f"{e['max_mem']} | {e['baseline_mem']} | {e['mem_limit']} | {status} |"
    )
lines += ["", "## Per-strategy samples", ""]
lines.append("| Op | Strategy version | CPU | Mem |")
lines.append("| --- | --- | ---: | ---: |")
for e in summary:
    for s in e["samples"]:
        lines.append(f"| `{s['op']}` | `{s['strategy']}` | {s['cpu']} | {s['mem']} |")
if failed:
    lines += ["", "## Regressions", ""]
    for f in failed:
        lines.append(f"- {f}")
open(report_md, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print("\n".join(lines))
if failed:
    print("BENCHMARK REGRESSION: " + "; ".join(failed), file=sys.stderr)
    sys.exit(1)
PY
