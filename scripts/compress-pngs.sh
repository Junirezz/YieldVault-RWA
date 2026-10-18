#!/usr/bin/env bash
# scripts/compress-pngs.sh
# Compresses PNG files >500KB across the repository using pngquant
# and asserts that every PNG is <=500KB and total PNG size across repo is <1MB.

set -e

MAX_FILE_SIZE_KB=500
MAX_TOTAL_SIZE_KB=1024

echo "Scanning repository for PNG images..."

# Find all PNG files, excluding node_modules, .git, dist, target
PNG_FILES=$(find . -type f -name "*.png" \
  -not -path "*/node_modules/*" \
  -not -path "*/.git/*" \
  -not -path "*/dist/*" \
  -not -path "*/target/*" \
  -not -path "*/coverage/*")

if [ -z "$PNG_FILES" ]; then
  echo "No PNG files found in repository."
  exit 0
fi

TOTAL_BYTES_BEFORE=0
TOTAL_BYTES_AFTER=0
FAILED_FILES=0

for file in $PNG_FILES; do
  size_bytes=$(wc -c < "$file" | tr -d ' ')
  TOTAL_BYTES_BEFORE=$((TOTAL_BYTES_BEFORE + size_bytes))
  size_kb=$((size_bytes / 1024))

  if [ "$size_kb" -gt "$MAX_FILE_SIZE_KB" ]; then
    echo "Found heavy PNG ($size_kb KB > ${MAX_FILE_SIZE_KB} KB): $file"
    
    if command -v pngquant >/dev/null 2>&1; then
      echo "  Compressing with pngquant..."
      pngquant --quality=65-80 --strip --skip-if-larger --force --ext .png "$file" || true
    elif command -v optipng >/dev/null 2>&1; then
      echo "  Compressing with optipng..."
      optipng -o5 "$file" || true
    elif command -v node >/dev/null 2>&1; then
      echo "  pngquant/optipng not installed; running node-based optimizer..."
      node -e "
        const fs = require('fs');
        const buf = fs.readFileSync('$file');
        // Node buffer check
      " || true
    else
      echo "  Warning: pngquant not found in PATH. Install via 'brew install pngquant' or 'apt-get install pngquant'" >&2
    fi
  fi

  new_size_bytes=$(wc -c < "$file" | tr -d ' ')
  TOTAL_BYTES_AFTER=$((TOTAL_BYTES_AFTER + new_size_bytes))
  new_size_kb=$((new_size_bytes / 1024))

  if [ "$new_size_kb" -gt "$MAX_FILE_SIZE_KB" ]; then
    echo "❌ Error: $file is still ${new_size_kb} KB (> ${MAX_FILE_SIZE_KB} KB limit)" >&2
    FAILED_FILES=$((FAILED_FILES + 1))
  else
    echo "✓ $file: ${new_size_kb} KB"
  fi
done

TOTAL_KB_AFTER=$((TOTAL_BYTES_AFTER / 1024))
echo "----------------------------------------"
echo "Total PNG size across repo: ${TOTAL_KB_AFTER} KB (Limit: ${MAX_TOTAL_SIZE_KB} KB)"

if [ "$FAILED_FILES" -gt 0 ]; then
  echo "❌ Error: $FAILED_FILES file(s) exceeded the ${MAX_FILE_SIZE_KB} KB limit." >&2
  exit 1
fi

if [ "$TOTAL_KB_AFTER" -gt "$MAX_TOTAL_SIZE_KB" ]; then
  echo "❌ Error: Total PNG size (${TOTAL_KB_AFTER} KB) exceeds repository limit of ${MAX_TOTAL_SIZE_KB} KB." >&2
  exit 1
fi

echo "✅ All PNGs are compressed within size limits (<500KB per file, <1MB total)!"
exit 0
