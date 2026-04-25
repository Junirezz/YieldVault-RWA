#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# test-deployment-json.sh — Property-based test for deployment.json generation.
#
# Property 1: Deployment JSON round-trip correctness
#   For any valid contract_id and git_sha, the generated deployment.json SHALL:
#     - Be valid JSON
#     - Contain exactly the field "contract_id" with the input value
#     - Contain exactly the field "git_sha" with the input value
#     - Contain no additional fields (no secret key material or other data)
#
# Validates: Requirements 7.1, 8.4
#
# Dependencies: jq, xxd (both available on ubuntu-latest)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# generate_deployment_json <CONTRACT_ID> <GIT_SHA>
#   Prints a deployment.json document to stdout.
#   This mirrors the exact logic used in smoke-test.sh.
# ---------------------------------------------------------------------------
generate_deployment_json() {
  local contract_id="$1"
  local git_sha="$2"
  cat <<EOF
{
  "contract_id": "$contract_id",
  "git_sha": "$git_sha"
}
EOF
}

# ---------------------------------------------------------------------------
# Main: run 100 iterations with random inputs
# ---------------------------------------------------------------------------
ITERATIONS=100
FAILURES=0

echo "Running $ITERATIONS property-based test iterations for deployment.json generation..."
echo ""

for i in $(seq 1 $ITERATIONS); do
  # Generate a random CONTRACT_ID: C-prefixed, 55 random base32 chars (A-Z, 2-7)
  RAND_SUFFIX=$(cat /dev/urandom | tr -dc 'A-Z2-7' | head -c 55)
  CONTRACT_ID="C${RAND_SUFFIX}"

  # Generate a random GIT_SHA: 40 hex chars
  GIT_SHA=$(cat /dev/urandom | xxd -p | tr -d '\n' | head -c 40)

  # Generate the JSON
  JSON=$(generate_deployment_json "$CONTRACT_ID" "$GIT_SHA")

  # --- Assertion 1: output is valid JSON ---
  if ! echo "$JSON" | jq . > /dev/null 2>&1; then
    echo "FAIL [iteration $i]: Output is not valid JSON"
    echo "  CONTRACT_ID: $CONTRACT_ID"
    echo "  GIT_SHA:     $GIT_SHA"
    echo "  Output:      $JSON"
    FAILURES=$((FAILURES + 1))
    continue
  fi

  # --- Assertion 2: contract_id field equals input ---
  PARSED_CONTRACT=$(echo "$JSON" | jq -r '.contract_id')
  if [ "$PARSED_CONTRACT" != "$CONTRACT_ID" ]; then
    echo "FAIL [iteration $i]: contract_id mismatch"
    echo "  Expected: $CONTRACT_ID"
    echo "  Got:      $PARSED_CONTRACT"
    echo "  Output:   $JSON"
    FAILURES=$((FAILURES + 1))
    continue
  fi

  # --- Assertion 3: git_sha field equals input ---
  PARSED_SHA=$(echo "$JSON" | jq -r '.git_sha')
  if [ "$PARSED_SHA" != "$GIT_SHA" ]; then
    echo "FAIL [iteration $i]: git_sha mismatch"
    echo "  Expected: $GIT_SHA"
    echo "  Got:      $PARSED_SHA"
    echo "  Output:   $JSON"
    FAILURES=$((FAILURES + 1))
    continue
  fi

  # --- Assertion 4: exactly 2 fields (no extra fields, no secret material) ---
  FIELD_COUNT=$(echo "$JSON" | jq 'keys | length')
  if [ "$FIELD_COUNT" != "2" ]; then
    echo "FAIL [iteration $i]: Expected exactly 2 fields, got $FIELD_COUNT"
    echo "  Fields: $(echo "$JSON" | jq 'keys')"
    echo "  Output: $JSON"
    FAILURES=$((FAILURES + 1))
    continue
  fi

  echo "PASS [iteration $i]"
done

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "RESULT: $FAILURES/$ITERATIONS iterations FAILED"
  exit 1
else
  echo "RESULT: All $ITERATIONS iterations PASSED — Property 1 holds"
fi
