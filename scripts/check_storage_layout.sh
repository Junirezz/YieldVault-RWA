#!/bin/bash
# Script to run storage layout fingerprints check

echo "Running Storage Layout Comparison..."
cargo test --package vault --lib proxy_tests::test_check_storage_layout_fingerprint -- --nocapture

if [ $? -eq 0 ]; then
    echo "Storage Layout Fingerprint: MATCH"
else
    echo "Storage Layout Fingerprint: MISMATCH / ERROR"
    exit 1
fi
