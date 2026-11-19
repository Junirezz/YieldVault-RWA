# Fuzz targets and seed corpora

Two libFuzzer targets live in `fuzz_targets/`:

| Target | Reach |
|--------|-------|
| `share_price_math` | Share-price invariants on 64-bit values (corpus below) |
| `share_price_extreme_ranges` | Full `i128` range and 0..=38 decimals; see the end of this file |

JSON fixtures in `seed_fixtures/` document representative inputs for the
`share_price_math` libFuzzer target (`fuzz_targets/share_price_math.rs`).

Each fixture maps to a 32-byte seed file under `corpus/share_price_math/`:

| Fixture | Corpus file | Scenario |
|---------|-------------|----------|
| `bootstrap_first_deposit.json` | `bootstrap_first_deposit` | Empty vault, 1:1 mint |
| `round_trip_truncation.json` | `round_trip_truncation` | Non-trivial share price with round-down |
| `yield_accrual.json` | `yield_accrual` | Yield increases redemption value |
| `proportional_vault.json` | `proportional_vault` | 50% share redemption |

## Encoding

Seeds are four little-endian `i128` values (8 bytes each):

1. `assets` — deposit or probe amount (must be positive)
2. `total_shares` — vault share supply before the operation (may be zero)
3. `total_assets` — vault asset balance before the operation (may be zero)
4. `yield_amount` — extra assets accrued (must be positive)

Use `share_price_math::fuzz_invariants::encode_vault_math_input` to regenerate corpus bytes
from JSON parameters.

## Running locally

```bash
cd contracts/vault
cargo install cargo-fuzz
rustup install nightly
cargo +nightly fuzz run share_price_math -- -max_total_time=60
```

Property tests in `src/fuzz_math.rs` cover the same invariants with proptest;
this corpus feeds libFuzzer for continuous exploration in CI.

## Extreme-range target (`share_price_extreme_ranges`)

`share_price_math` encodes only 8 bytes per value, so it never exceeds `u64::MAX`.
`share_price_extreme_ranges` decodes full 16-byte `i128` values and steers them to
the boundaries where the `a * b` intermediate overflows (`sqrt(i128::MAX)`,
`i128::MAX`, `10^decimals` for 0..=38 decimals, 7-decimal and 18-decimal asset
units, and the rounding fixture values scaled by `10^7` and `10^18`).

It asserts, for every input:

- no panic from any conversion entry point, including negative values and `i128::MIN`;
- overflow is reported exactly when the product does not fit in `i128`, checked
  against an independent 256-bit reference (no spurious or missed overflow);
- rounding up is never cheaper than rounding down and differs by at most 1;
- conversions are monotonic in the amount, and share price is monotonic under yield;
- deposit/redeem round trips never create value, and withdraw/mint quotes never
  favour the user.

The logic lives in `share_price_math::extreme_range`, so the same invariants also
run on stable Rust under `cargo test -p share-price-math` (including a boundary
grid and a deterministic pseudo-random sweep).

### Input layout

66 bytes, little-endian; shorter input is zero-padded. Bytes `0..16`, `16..32`,
`32..48`, `48..64` are raw `assets`, `total_shares`, `total_assets` and `delta`;
byte `64` is the decimals selector (mod 39); byte `65` holds a 2-bit shaping kind
per field (raw, boundary table, `10^decimals` +/- 1, mantissa x `10^decimals`).

### Corpus and regressions

Seeds in `corpus/share_price_extreme_ranges/` are generated, not hand-written:

```bash
cargo test -p share-price-math regenerate_extreme_corpus -- --ignored
```

A normal test (`committed_corpus_is_in_sync_with_generator`) fails if a committed
seed drifts from the generator. When libFuzzer finds a failing input, it writes it
to `fuzz/artifacts/share_price_extreme_ranges/`: copy that file into the corpus
directory so it becomes a permanent regression seed, then add a deterministic
case to `extreme_range.rs` where practical.

Run locally:

```bash
cd contracts/vault
cargo +nightly fuzz run share_price_extreme_ranges -- -max_total_time=60
```
