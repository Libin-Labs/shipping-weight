export type RoundingMode = 'floor' | 'ceil' | 'half-even' | 'half-up' | 'trunc';
export type MassUnit = 'mg' | 'g' | 'kg' | 'oz' | 'lb';
export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type Measure = number | string;

export interface MassQuantity {
  readonly value: Measure;
  readonly unit: MassUnit;
}

export interface Dimensions {
  readonly length: Measure;
  readonly width: Measure;
  readonly height: Measure;
  readonly unit: LengthUnit;
}

/** "`volume` cubic `lengthUnit` count as `mass` `massUnit`", e.g. 5000 cm^3 per 1 kg. */
export interface DimensionalDivisor {
  readonly volume: Measure;
  readonly lengthUnit: LengthUnit;
  readonly mass: Measure;
  readonly massUnit: MassUnit;
}

export interface BillableWeightInput {
  /** Total actual weight of the whole shipment. */
  readonly actual: MassQuantity;
  /** Size of one piece. Omit to bill actual weight only. */
  readonly dimensions?: Dimensions;
  readonly divisor?: DimensionalDivisor;
  /** Number of identical pieces measured by `dimensions`; default 1. */
  readonly pieces?: number;
  /** Billable weight is rounded to a multiple of this amount. */
  readonly increment?: MassQuantity;
  /** Billable weight is never below this amount (applied after the increment). */
  readonly minimum?: MassQuantity;
  /** Unit for the formatted result; defaults to the actual weight's unit. */
  readonly outputUnit?: MassUnit;
  /** Fractional digits in the formatted result, 0 to 12. Default 3. */
  readonly outputScale?: number;
  /** Used for every inexact step. Defaults to `ceil` (bill up). */
  readonly rounding?: RoundingMode;
}

export interface BillableWeight {
  readonly actualNanograms: bigint;
  readonly dimensionalNanograms: bigint | null;
  readonly billableNanograms: bigint;
  readonly basis: 'actual' | 'dimensional';
  readonly outputUnit: MassUnit;
  readonly billable: string;
}

export type ShippingErrorCode = 'invalid-input' | 'invalid-option';

export class ShippingError extends Error {
  readonly code: ShippingErrorCode;
  constructor(code: ShippingErrorCode, message: string) {
    super(message);
    this.name = 'ShippingError';
    this.code = code;
  }
}

/** Exact nanogram value of one unit. */
export const MASS_UNITS: Readonly<Record<MassUnit, bigint>> = Object.freeze({
  mg: 1_000_000n,
  g: 1_000_000_000n,
  kg: 1_000_000_000_000n,
  oz: 28_349_523_125n,
  lb: 453_592_370_000n,
});

/** Exact micrometre value of one unit. */
export const LENGTH_UNITS: Readonly<Record<LengthUnit, bigint>> = Object.freeze({
  mm: 1_000n,
  cm: 10_000n,
  m: 1_000_000n,
  in: 25_400n,
  ft: 304_800n,
});

const MODES: readonly RoundingMode[] = ['floor', 'ceil', 'half-even', 'half-up', 'trunc'];
const MAX_FRACTION_DIGITS = 12;

function divRound(n: bigint, d: bigint, mode: RoundingMode): bigint {
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const q = n / d;
  const r = n % d;
  if (r === 0n) return q;
  const negative = n < 0n;
  const away = negative ? q - 1n : q + 1n;
  const twice = (r < 0n ? -r : r) * 2n;
  switch (mode) {
    case 'trunc':
      return q;
    case 'floor':
      return negative ? away : q;
    case 'ceil':
      return negative ? q : away;
    case 'half-up':
      return twice >= d ? away : q;
    case 'half-even':
      return twice > d || (twice === d && q % 2n !== 0n) ? away : q;
  }
}

interface Scaled {
  coefficient: bigint;
  scale: number;
}

function scaled(value: unknown, name: string): Scaled {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value;
  const match = typeof text === 'string' ? /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text) : null;
  if (!match || (typeof value === 'string' && match[3] !== undefined)) {
    throw new ShippingError('invalid-input', `${name} must be a non-negative finite decimal.`);
  }
  const fraction = match[2] ?? '';
  const exponent = Number(match[3] ?? 0) - fraction.length;
  const digits = BigInt((match[1] ?? '0') + fraction);
  if (exponent >= 0) {
    if (exponent > 12) throw new ShippingError('invalid-input', `${name} is too large.`);
    return { coefficient: digits * 10n ** BigInt(exponent), scale: 0 };
  }
  if (-exponent > MAX_FRACTION_DIGITS + 6) {
    throw new ShippingError('invalid-input', `${name} has too many fractional digits.`);
  }
  return { coefficient: digits, scale: -exponent };
}

function unitOf<T extends string>(
  table: Readonly<Record<T, bigint>>,
  unit: unknown,
  name: string,
): bigint {
  const factor =
    typeof unit === 'string' && Object.hasOwn(table, unit) ? table[unit as T] : undefined;
  if (factor === undefined) throw new ShippingError('invalid-input', `Unknown ${name} unit.`);
  return factor;
}

function modeOf(mode: RoundingMode | undefined): RoundingMode {
  const result = mode ?? 'ceil';
  if (!MODES.includes(result)) throw new ShippingError('invalid-option', 'Unknown rounding mode.');
  return result;
}

function toBase(value: Measure, factor: bigint, name: string, mode: RoundingMode): bigint {
  const parsed = scaled(value, name);
  return divRound(parsed.coefficient * factor, 10n ** BigInt(parsed.scale), mode);
}

function format(base: bigint, factor: bigint, digits: number, mode: RoundingMode): string {
  const units = divRound(base * 10n ** BigInt(digits), factor, mode);
  const text = units.toString().padStart(digits + 1, '0');
  return digits === 0 ? text : `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}

/** Converts a mass between units and returns a decimal string with `scale` fractional digits. */
export function convertMass(
  value: Measure,
  from: MassUnit,
  to: MassUnit,
  options: { readonly scale?: number; readonly rounding?: RoundingMode } = {},
): string {
  const mode = modeOf(options.rounding);
  const digits = digitsOf(options.scale);
  const exact = scaled(value, 'value');
  const numerator = exact.coefficient * unitOf(MASS_UNITS, from, 'mass');
  return formatRational(
    numerator,
    10n ** BigInt(exact.scale) * unitOf(MASS_UNITS, to, 'mass'),
    digits,
    mode,
  );
}

/** Converts a length between units and returns a decimal string with `scale` fractional digits. */
export function convertLength(
  value: Measure,
  from: LengthUnit,
  to: LengthUnit,
  options: { readonly scale?: number; readonly rounding?: RoundingMode } = {},
): string {
  const mode = modeOf(options.rounding);
  const digits = digitsOf(options.scale);
  const exact = scaled(value, 'value');
  return formatRational(
    exact.coefficient * unitOf(LENGTH_UNITS, from, 'length'),
    10n ** BigInt(exact.scale) * unitOf(LENGTH_UNITS, to, 'length'),
    digits,
    mode,
  );
}

function digitsOf(scale: number | undefined): number {
  const digits = scale ?? 3;
  if (!Number.isInteger(digits) || digits < 0 || digits > MAX_FRACTION_DIGITS) {
    throw new ShippingError(
      'invalid-option',
      `scale must be an integer from 0 to ${MAX_FRACTION_DIGITS}.`,
    );
  }
  return digits;
}

function formatRational(n: bigint, d: bigint, digits: number, mode: RoundingMode): string {
  const units = divRound(n * 10n ** BigInt(digits), d, mode);
  const text = units.toString().padStart(digits + 1, '0');
  return digits === 0 ? text : `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}

/**
 * Dimensional weight of one piece in nanograms: volume divided by the caller's divisor volume,
 * times the divisor mass, all computed exactly before one rounding.
 */
export function dimensionalNanograms(
  dimensions: Dimensions,
  divisor: DimensionalDivisor,
  rounding?: RoundingMode,
): bigint {
  const mode = modeOf(rounding);
  const lengthFactor = unitOf(LENGTH_UNITS, dimensions?.unit, 'length');
  const edges = [dimensions.length, dimensions.width, dimensions.height].map((edge, index) =>
    scaled(edge, ['length', 'width', 'height'][index] ?? 'edge'),
  );
  const volume = scaled(divisor?.volume, 'divisor.volume');
  const mass = scaled(divisor?.mass, 'divisor.mass');
  if (volume.coefficient === 0n || mass.coefficient === 0n) {
    throw new ShippingError('invalid-input', 'Divisor volume and mass must be positive.');
  }
  const divisorLength = unitOf(LENGTH_UNITS, divisor.lengthUnit, 'length');
  const divisorMass = unitOf(MASS_UNITS, divisor.massUnit, 'mass');
  // piece volume (um^3) = e1 e2 e3 L^3 / 10^(s1+s2+s3); divisor volume = v Ld^3 / 10^sv.
  const numerator =
    edges.reduce((product, edge) => product * edge.coefficient, 1n) *
    lengthFactor ** 3n *
    mass.coefficient *
    divisorMass *
    10n ** BigInt(volume.scale);
  const denominator =
    10n ** BigInt(edges.reduce((total, edge) => total + edge.scale, 0) + mass.scale) *
    volume.coefficient *
    divisorLength ** 3n;
  return divRound(numerator, denominator, mode);
}

export function billableWeight(input: BillableWeightInput): BillableWeight {
  const mode = modeOf(input?.rounding);
  const digits = digitsOf(input.outputScale);
  const actualUnit = unitOf(MASS_UNITS, input.actual?.unit, 'mass');
  const actual = toBase(input.actual.value, actualUnit, 'actual.value', mode);
  const outputUnit = input.outputUnit ?? input.actual.unit;
  const outputFactor = unitOf(MASS_UNITS, outputUnit, 'mass');
  const pieces = input.pieces ?? 1;
  if (!Number.isInteger(pieces) || pieces < 1 || pieces > 1_000_000) {
    throw new ShippingError('invalid-input', 'pieces must be an integer from 1 to 1000000.');
  }
  if ((input.dimensions === undefined) !== (input.divisor === undefined)) {
    throw new ShippingError('invalid-input', 'dimensions and divisor must be given together.');
  }
  let dimensional: bigint | null = null;
  if (input.dimensions !== undefined && input.divisor !== undefined) {
    dimensional = dimensionalNanograms(input.dimensions, input.divisor, mode) * BigInt(pieces);
  }
  const basis = dimensional !== null && dimensional > actual ? 'dimensional' : 'actual';
  let billable = basis === 'dimensional' && dimensional !== null ? dimensional : actual;
  if (input.increment !== undefined) {
    const step = toBase(
      input.increment.value,
      unitOf(MASS_UNITS, input.increment.unit, 'mass'),
      'increment.value',
      mode,
    );
    if (step <= 0n) throw new ShippingError('invalid-input', 'increment must be positive.');
    billable = divRound(billable, step, mode) * step;
  }
  if (input.minimum !== undefined) {
    const floor = toBase(
      input.minimum.value,
      unitOf(MASS_UNITS, input.minimum.unit, 'mass'),
      'minimum.value',
      mode,
    );
    if (billable < floor) billable = floor;
  }
  return Object.freeze({
    actualNanograms: actual,
    dimensionalNanograms: dimensional,
    billableNanograms: billable,
    basis,
    outputUnit,
    billable: format(billable, outputFactor, digits, mode),
  });
}
