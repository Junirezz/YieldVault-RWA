import Decimal from 'decimal.js';
import { NumericDecimal, toNumeric38_18 } from '../numericColumns';
import {
  checkTypeMapping,
  loadSources,
} from '../../scripts/check-type-mapping';

/** Largest value PostgreSQL NUMERIC(38, 18) can hold. */
const MAX_NUMERIC = '99999999999999999999.999999999999999999';
const SMALLEST_STEP = '0.000000000000000001';

describe('NUMERIC(38, 18) precision (issue #1546)', () => {
  it('round-trips the full 38-digit range through the String encoding', () => {
    for (const value of [MAX_NUMERIC, `-${MAX_NUMERIC}`, SMALLEST_STEP, '0', '1.5']) {
      expect(toNumeric38_18(value)).toBe(value);
      expect(toNumeric38_18(toNumeric38_18(value))).toBe(value);
    }
  });

  it('keeps sums exact where default Decimal precision rounds', () => {
    const sum = new NumericDecimal('99999999999999999999.999999999999999998').plus(SMALLEST_STEP);
    expect(toNumeric38_18(sum)).toBe(MAX_NUMERIC);

    const lossy = new Decimal('99999999999999999999.999999999999999998').plus(SMALLEST_STEP);
    expect(lossy.toFixed()).not.toBe(MAX_NUMERIC);
  });

  it('rejects values PostgreSQL would reject', () => {
    expect(() => toNumeric38_18('100000000000000000000')).toThrow(RangeError);
    expect(() => toNumeric38_18('0.0000000000000000001')).toThrow(RangeError);
    expect(() => toNumeric38_18('Infinity')).toThrow(RangeError);
    expect(() => toNumeric38_18('NaN')).toThrow(RangeError);
  });
});

describe('dev/prod type mapping check', () => {
  it('passes for the committed schema, migrations and mapping', () => {
    expect(checkTypeMapping(loadSources())).toEqual([]);
  });

  it('flags an unlisted NUMERIC column and a mismatched Prisma type', () => {
    const sources = loadSources();
    const sql = `${sources.sql}\nCREATE TABLE IF NOT EXISTS fees (\n    total NUMERIC(38, 18) NOT NULL\n);`;
    const schema = sources.schema.replace(/(model Transaction \{[\s\S]*?amount\s+)String/, '$1Float');
    expect(checkTypeMapping({ ...sources, sql, schema })).toEqual([
      'fees.total (NUMERIC(38,18)) is not listed in postgres-type-mapping.json',
      'transactions.amount (NUMERIC(38,18)) maps to Transaction.amount which is Float, expected String',
    ]);
  });
});
