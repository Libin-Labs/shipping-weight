# @lp-labs/shipping-weight

Exact actual-versus-dimensional billable weight for shipping calculations. You supply the divisor
and rounding policy; the library does exact unit conversion (all factors are exact definitions) and
rounds only where you tell it to. No carrier rules, no registry of carriers.

## Install

```bash
npm install @lp-labs/shipping-weight
```

ES2022 ESM and CommonJS builds ship with TypeScript declarations. There are no runtime dependencies.

## Quickstart

```js
import { billableWeight, convertMass } from '@lp-labs/shipping-weight';

const result = billableWeight({
  actual: { value: '1.2', unit: 'kg' },
  dimensions: { length: 40, width: 30, height: 20, unit: 'cm' },
  divisor: { volume: 5000, lengthUnit: 'cm', mass: 1, massUnit: 'kg' }, // 5000 cm^3 per kg
  increment: { value: 0.5, unit: 'kg' },
});
if (result.basis !== 'dimensional' || result.billable !== '5.000') throw new Error('unexpected');
console.log(result.billable, result.outputUnit, convertMass(1, 'lb', 'kg', { scale: 4 }));
```

## API

```ts
type RoundingMode = 'floor' | 'ceil' | 'half-even' | 'half-up' | 'trunc';
type MassUnit = 'mg' | 'g' | 'kg' | 'oz' | 'lb';
type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
type Measure = number | string;
interface MassQuantity {
  value: Measure;
  unit: MassUnit;
}
interface Dimensions {
  length: Measure;
  width: Measure;
  height: Measure;
  unit: LengthUnit;
}
interface DimensionalDivisor {
  volume: Measure;
  lengthUnit: LengthUnit;
  mass: Measure;
  massUnit: MassUnit;
}
interface BillableWeightInput {
  actual: MassQuantity;
  dimensions?: Dimensions;
  divisor?: DimensionalDivisor;
  pieces?: number;
  increment?: MassQuantity;
  minimum?: MassQuantity;
  outputUnit?: MassUnit;
  outputScale?: number;
  rounding?: RoundingMode;
}
interface BillableWeight {
  actualNanograms: bigint;
  dimensionalNanograms: bigint | null;
  billableNanograms: bigint;
  basis: 'actual' | 'dimensional';
  outputUnit: MassUnit;
  billable: string;
}
type ShippingErrorCode = 'invalid-input' | 'invalid-option';
class ShippingError extends Error {
  readonly code: ShippingErrorCode;
}
const MASS_UNITS: Readonly<Record<MassUnit, bigint>>; // nanograms per unit
const LENGTH_UNITS: Readonly<Record<LengthUnit, bigint>>; // micrometres per unit

function billableWeight(input: BillableWeightInput): BillableWeight;
function dimensionalNanograms(
  dimensions: Dimensions,
  divisor: DimensionalDivisor,
  rounding?: RoundingMode,
): bigint;
function convertMass(
  value: Measure,
  from: MassUnit,
  to: MassUnit,
  options?: { scale?: number; rounding?: RoundingMode },
): string;
function convertLength(
  value: Measure,
  from: LengthUnit,
  to: LengthUnit,
  options?: { scale?: number; rounding?: RoundingMode },
): string;
```

- Numbers and strings are plain non-negative decimals (no exponents in strings, no `NaN`/`Infinity`).
  A `number` is read from its shortest decimal text, so `1.2` means exactly 1.2.
- Dimensional weight per piece is `volume / divisorVolume * divisorMass`, computed exactly and rounded
  once to nanograms; it is multiplied by `pieces`. `actual` is the weight of the whole shipment.
- Billable weight is the larger of actual and dimensional (`basis` is `actual` on a tie), then rounded
  to a multiple of `increment`, then raised to `minimum`.
- `rounding` defaults to `ceil` (bill up) and is used for all inexact steps, including the final
  formatting to `outputScale` digits (default 3). Choose another mode if your policy differs.

## Customization

The divisor, increment, minimum, units, and rounding are all yours. Per-piece rounding of dimensions
(for example rounding each edge up to a whole inch) is a caller step: pass the already-rounded edges.

## Errors

`ShippingError` with `invalid-input` (malformed numbers, unknown units, missing divisor, zero divisor,
bad `pieces`) or `invalid-option` (rounding mode, output scale).

## Performance

A fixed number of bigint operations per call.

## Honest scope

This is arithmetic. It does not know any carrier's rules (zones, surcharges, minimum charges, edge
rounding, oversize rules) and does not guarantee that a carrier will bill the same value. Verify with
your carrier's published policy.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
