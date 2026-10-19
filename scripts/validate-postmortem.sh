#!/usr/bin/env bash
# Validate postmortem markdown structure for published reports in docs/incidents/.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INCIDENTS_DIR="${REPO_ROOT}/docs/incidents"

REQUIRED_HEADINGS=(
  "## Summary"
  "## Impact"
  "## Timeline"
  "## Root Cause"
  "## Action Items"
  "## Lessons Learned"
)

errors=0

validate_published_report() {
  local file="$1"
  local basename
  basename="$(basename "$file")"

  if [[ "$basename" == "README.md" ]]; then
    return 0
  fi

  if [[ "$basename" == .gitkeep ]]; then
    return 0
  fi

  if [[ "$file" == *"/drafts/"* ]]; then
    return 0
  fi

  if [[ ! "$basename" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}-INCIDENT-.+\.md$ ]]; then
    echo "ERROR: ${file}: filename must match YYYY-MM-DD-INCIDENT-*.md"
    errors=$((errors + 1))
  fi

  for heading in "${REQUIRED_HEADINGS[@]}"; do
    if ! grep -qF "$heading" "$file"; then
      echo "ERROR: ${file}: missing required heading ${heading}"
      errors=$((errors + 1))
    fi
  done

  if grep -qE '^\*\*Status:\*\*.*Draft' "$file"; then
    echo "ERROR: ${file}: published reports must not have Status: Draft"
    errors=$((errors + 1))
  fi

  if ! grep -qE '^\| ID \| Action \| Owner \|' "$file"; then
    echo "ERROR: ${file}: action items table must include ID, Action, Owner columns"
    errors=$((errors + 1))
  fi
}

# Validate templates exist
for template in post-mortem.md incident-report.md dr-test-report.md; do
  if [[ ! -f "${REPO_ROOT}/docs/runbooks/templates/${template}" ]]; then
    echo "ERROR: missing template docs/runbooks/templates/${template}"
    errors=$((errors + 1))
  fi
done

if [[ ! -f "${REPO_ROOT}/docs/postmortem-playbook.md" ]]; then
  echo "ERROR: missing docs/postmortem-playbook.md"
  errors=$((errors + 1))
fi

# Validate published incident reports (if any)
if [[ -d "$INCIDENTS_DIR" ]]; then
  while IFS= read -r -d '' file; do
    validate_published_report "$file"
  done < <(find "$INCIDENTS_DIR" -maxdepth 1 -name '*.md' -print0 2>/dev/null || true)
fi

if [[ "$errors" -gt 0 ]]; then
  echo "Postmortem validation failed with ${errors} error(s)."
  exit 1
fi

echo "Postmortem validation passed."
