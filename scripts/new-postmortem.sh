#!/usr/bin/env bash
# Scaffold a new postmortem draft from the standard template.
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 INCIDENT-123 short-slug"
  echo "Example: $0 INCIDENT-123 rpc-failover"
  exit 1
fi

INCIDENT_ID="$1"
SLUG="$2"
DATE="$(date -u +%Y-%m-%d)"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRAFTS_DIR="${REPO_ROOT}/docs/incidents/drafts"
TEMPLATE="${REPO_ROOT}/docs/runbooks/templates/post-mortem.md"
OUTPUT="${DRAFTS_DIR}/${DATE}-${INCIDENT_ID}-${SLUG}.md"

mkdir -p "$DRAFTS_DIR"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "ERROR: template not found at ${TEMPLATE}"
  exit 1
fi

cp "$TEMPLATE" "$OUTPUT"
sed -i "s/INCIDENT-___/${INCIDENT_ID}/" "$OUTPUT" 2>/dev/null || \
  sed -i '' "s/INCIDENT-___/${INCIDENT_ID}/" "$OUTPUT"
sed -i "s/YYYY-MM-DD/${DATE}/" "$OUTPUT" 2>/dev/null || \
  sed -i '' "s/YYYY-MM-DD/${DATE}/" "$OUTPUT"

echo "Created draft: ${OUTPUT}"
