#!/usr/bin/env bash
# scripts/purge-git-large-blobs.sh
# Purges uncompressed large binary assets (>1MB) from git history and aggressive gcs repo packfiles.
# Keeps .git folder well under 80MB.

set -e

echo "=== Git History Blob Purge ==="

if command -v git-filter-repo >/dev/null 2>&1; then
  echo "Using git-filter-repo to strip historical blobs >1M..."
  git-filter-repo --strip-blobs-bigger-than 1M --force
elif command -v bfg >/dev/null 2>&1; then
  echo "Using bfg repo-cleaner to strip historical blobs >1M..."
  bfg --strip-blobs-bigger-than 1M
else
  echo "Neither git-filter-repo nor bfg found. Recommended install:"
  echo "  pip install git-filter-repo   OR   brew install bfg"
fi

echo "Cleaning reflog and running aggressive git garbage collection..."
git reflog expire --expire=now --all 2>/dev/null || true
git gc --prune=now --aggressive 2>/dev/null || true

echo "=== Git Directory Size ==="
du -sh .git 2>/dev/null || true
echo "Done!"
