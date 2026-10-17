import Decimal from 'decimal.js';

/**
 * Encoding contract for Prisma `String` columns that map to PostgreSQL
 * `NUMERIC(38, 18)` (see prisma/postgres-type-mapping.json, issue #1546).
 *
 * SQLite has no exact decimal type, so dev stores these amounts as strings.
 * Decimal.js defaults to 20 significant digits, which silently rounds values
 * that PostgreSQL stores exactly; arithmetic on these columns must use
 * `NumericDecimal`, and values must pass `toNumeric38_18` to be accepted by
 * both databases.
 */
export const NUMERIC_PRECISION = 38;
export const NUMERIC_SCALE = 18;

export const NumericDecimal = Decimal.clone({ precision: NUMERIC_PRECISION });

const MAX_INTEGER_DIGITS = NUMERIC_PRECISION - NUMERIC_SCALE;

/**
 * Returns `value` as a plain decimal string with at most 18 fractional
 * digits, exactly as PostgreSQL `NUMERIC(38, 18)` would store it.
 *
 * @throws RangeError if the value is not finite, has more than 18 fractional
 *   digits, or more than 20 integer digits (PostgreSQL would reject it).
 */
export function toNumeric38_18(value: Decimal.Value): string {
  const decimal = new NumericDecimal(value);
  if (!decimal.isFinite()) {
    throw new RangeError(`NUMERIC(38, 18) value must be finite: ${String(value)}`);
  }
  if (decimal.decimalPlaces() > NUMERIC_SCALE) {
    throw new RangeError(`NUMERIC(38, 18) allows ${NUMERIC_SCALE} fractional digits: ${String(value)}`);
  }
  if (decimal.abs().trunc().toFixed(0).replace(/^0$/, '').length > MAX_INTEGER_DIGITS) {
    throw new RangeError(`NUMERIC(38, 18) allows ${MAX_INTEGER_DIGITS} integer digits: ${String(value)}`);
  }
  return decimal.toFixed();
}
