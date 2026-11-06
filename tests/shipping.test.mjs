import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  billableWeight,
  convertMass,
  convertLength,
  dimensionalNanograms,
  ShippingError,
  MASS_UNITS,
} from '../dist/esm/index.js';

const cm5000 = { volume: 5000, lengthUnit: 'cm', mass: 1, massUnit: 'kg' };
const in139 = { volume: 139, lengthUnit: 'in', mass: 1, massUnit: 'lb' };

test('dimensional weight uses the caller divisor exactly', () => {
  // 40x30x20 cm = 24000 cm3 / 5000 = 4.8 kg
  assert.equal(
    dimensionalNanograms({ length: 40, width: 30, height: 20, unit: 'cm' }, cm5000),
    4_800_000_000_000n,
  );
  // 12x10x8 in = 960 in3 / 139 per lb
  const got = dimensionalNanograms(
    { length: 12, width: 10, height: 8, unit: 'in' },
    in139,
    'floor',
  );
  assert.equal(got, (960n * 453_592_370_000n) / 139n);
  // the same box expressed in cm with an inch divisor agrees (exact unit conversion)
  const cm = dimensionalNanograms(
    { length: 30.48, width: 25.4, height: 20.32, unit: 'cm' },
    in139,
    'floor',
  );
  assert.equal(cm, got);
  // different divisor unit, same physical divisor
  const alt = dimensionalNanograms(
    { length: 40, width: 30, height: 20, unit: 'cm' },
    { volume: '0.005', lengthUnit: 'm', mass: '1000000', massUnit: 'mg' },
  );
  assert.equal(alt, 4_800_000_000_000n);
});

test('billable chooses the larger of actual and dimensional with a stated basis', () => {
  const box = { length: 40, width: 30, height: 20, unit: 'cm' };
  const light = billableWeight({
    actual: { value: 1.2, unit: 'kg' },
    dimensions: box,
    divisor: cm5000,
  });
  assert.equal(light.basis, 'dimensional');
  assert.equal(light.billable, '4.800');
  const heavy = billableWeight({
    actual: { value: '6', unit: 'kg' },
    dimensions: box,
    divisor: cm5000,
  });
  assert.equal(heavy.basis, 'actual');
  assert.equal(heavy.billable, '6.000');
  const tie = billableWeight({
    actual: { value: '4.8', unit: 'kg' },
    dimensions: box,
    divisor: cm5000,
  });
  assert.equal(tie.basis, 'actual');
  const plain = billableWeight({
    actual: { value: 10, unit: 'lb' },
    outputUnit: 'kg',
    outputScale: 4,
  });
  assert.equal(plain.billable, '4.5360'); // 4.5359237 bills up by default
  assert.equal(
    billableWeight({
      actual: { value: 10, unit: 'lb' },
      outputUnit: 'kg',
      outputScale: 4,
      rounding: 'half-even',
    }).billable,
    '4.5359',
  );
  assert.equal(plain.dimensionalNanograms, null);
});

test('increment, minimum, pieces, and rounding policy', () => {
  const box = { length: 10, width: 10, height: 10, unit: 'cm' };
  const base = { actual: { value: 100, unit: 'g' }, dimensions: box, divisor: cm5000, pieces: 3 };
  assert.equal(billableWeight(base).billableNanograms, 600_000_000_000n); // 3 x 0.2 kg
  const stepped = billableWeight({
    ...base,
    actual: { value: 10, unit: 'g' },
    pieces: 1,
    increment: { value: 0.5, unit: 'kg' },
    outputUnit: 'kg',
  });
  assert.equal(stepped.billable, '0.500');
  const over = billableWeight({
    actual: { value: 1.01, unit: 'kg' },
    increment: { value: 500, unit: 'g' },
  });
  assert.equal(over.billable, '1.500');
  const down = billableWeight({
    actual: { value: 1.01, unit: 'kg' },
    increment: { value: 500, unit: 'g' },
    rounding: 'floor',
  });
  assert.equal(down.billable, '1.000');
  const min = billableWeight({
    actual: { value: 10, unit: 'g' },
    minimum: { value: 1, unit: 'lb' },
    outputUnit: 'lb',
    outputScale: 2,
  });
  assert.equal(min.billable, '1.00');
  assert.equal(
    billableWeight({
      actual: { value: '0.0005', unit: 'g' },
      rounding: 'floor',
      outputScale: 6,
      outputUnit: 'mg',
    }).billable,
    '0.500000',
  );
});

test('unit conversion is exact and reproducible', () => {
  assert.equal(convertMass(1, 'lb', 'g', { scale: 5 }), '453.59237');
  assert.equal(convertMass(16, 'oz', 'lb', { scale: 3 }), '1.000');
  assert.equal(convertMass('1.5', 'kg', 'g', { scale: 0 }), '1500');
  assert.equal(convertMass(1, 'g', 'kg', { scale: 3, rounding: 'floor' }), '0.001');
  assert.equal(convertMass(1, 'mg', 'kg', { scale: 3, rounding: 'ceil' }), '0.001');
  assert.equal(convertMass(1, 'mg', 'kg', { scale: 3, rounding: 'floor' }), '0.000');
  assert.equal(convertLength(1, 'in', 'mm', { scale: 1 }), '25.4');
  assert.equal(convertLength(1, 'ft', 'in', { scale: 0 }), '12');
  assert.equal(convertLength(1, 'm', 'ft', { scale: 4, rounding: 'half-even' }), '3.2808');
  assert.equal(MASS_UNITS.lb, 453_592_370_000n);
});

test('invalid numbers, units, and options are rejected', () => {
  const ok = { actual: { value: 1, unit: 'kg' } };
  for (const bad of [-1, NaN, Infinity, '1e3', '', ' 1', 'abc', '1.2.3', null, 1e300]) {
    assert.throws(
      () => billableWeight({ actual: { value: bad, unit: 'kg' } }),
      ShippingError,
      String(bad),
    );
  }
  assert.throws(() => billableWeight({ actual: { value: 1, unit: 'stone' } }), ShippingError);
  assert.throws(() => billableWeight({ actual: { value: 1, unit: 'toString' } }), ShippingError);
  assert.throws(() => billableWeight({ ...ok, rounding: 'nearest' }), { code: 'invalid-option' });
  assert.throws(() => billableWeight({ ...ok, outputScale: 13 }), { code: 'invalid-option' });
  assert.throws(() => billableWeight({ ...ok, pieces: 0 }), ShippingError);
  assert.throws(
    () => billableWeight({ ...ok, dimensions: { length: 1, width: 1, height: 1, unit: 'cm' } }),
    ShippingError,
  );
  assert.throws(() => billableWeight({ ...ok, increment: { value: 0, unit: 'g' } }), ShippingError);
  assert.throws(
    () =>
      billableWeight({
        ...ok,
        dimensions: { length: 1, width: 1, height: 1, unit: 'cm' },
        divisor: { ...cm5000, volume: 0 },
      }),
    ShippingError,
  );
  assert.throws(
    () =>
      billableWeight({
        ...ok,
        dimensions: { length: 1, width: 1, height: 1, unit: 'yd' },
        divisor: cm5000,
      }),
    ShippingError,
  );
});

test('zero-sized shipment is allowed, large values stay exact, CJS agrees', () => {
  assert.equal(billableWeight({ actual: { value: 0, unit: 'kg' } }).billable, '0.000');
  const big = billableWeight({ actual: { value: '999999999', unit: 'kg' } });
  assert.equal(big.billableNanograms, 999_999_999n * 10n ** 12n);
  assert.equal(
    createRequire(import.meta.url)('@lp-labs/shipping-weight').convertMass(2, 'kg', 'g', {
      scale: 0,
    }),
    '2000',
  );
});
