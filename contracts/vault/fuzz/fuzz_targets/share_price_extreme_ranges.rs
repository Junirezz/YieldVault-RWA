//! libFuzzer harness for share-price conversion across the full `i128` and
//! decimal range (0..=38 places).
//!
//! Unlike `share_price_math`, which only reaches 64-bit values, this target
//! decodes full 16-byte integers and steers them onto the boundaries where the
//! `a * b` intermediate overflows. It asserts no panics, no spurious or missed
//! overflow (checked against a 256-bit reference), monotonic conversion and
//! share price under yield, and that quotes never favour the user.
//!
//! Seeded from `fuzz/corpus/share_price_extreme_ranges/`, which is generated from
//! the rounding fixtures and boundary values (see `fuzz/README.md`).

#![no_main]

use libfuzzer_sys::fuzz_target;
use share_price_math::extreme_range::{assert_extreme_range_invariants, decode_extreme_input};

fuzz_target!(|data: &[u8]| {
    assert_extreme_range_invariants(&decode_extreme_input(data));
});
