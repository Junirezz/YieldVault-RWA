#!/usr/bin/env bash
# Builds the backend image and asserts the acceptance criteria from #1464:
#   - image size < 500 MB
#   - no .git directory inside the image
set -euo pipefail

IMAGE="${IMAGE:-yieldvault-backend:size-test}"
MAX_MB="${MAX_MB:-500}"

docker build -t "$IMAGE" .

size_bytes=$(docker image inspect "$IMAGE" --format '{{.Size}}')
size_mb=$(( size_bytes / 1024 / 1024 ))
echo "Image size: ${size_mb} MB (limit ${MAX_MB} MB)"
if [ "$size_mb" -ge "$MAX_MB" ]; then
  echo "FAIL: image is ${size_mb} MB, expected < ${MAX_MB} MB" >&2
  exit 1
fi

# `ls -la .git` must fail (non-zero exit) because the directory must not exist
if docker run --rm --entrypoint ls "$IMAGE" -la .git >/dev/null 2>&1; then
  echo "FAIL: .git directory found inside the image" >&2
  exit 1
fi
echo "OK: no .git directory in image"

echo "PASS"
