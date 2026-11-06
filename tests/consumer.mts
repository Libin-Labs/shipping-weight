import {
  billableWeight,
  convertMass,
  type BillableWeight,
  type DimensionalDivisor,
} from '@lp-labs/shipping-weight';

const divisor: DimensionalDivisor = { volume: 5000, lengthUnit: 'cm', mass: 1, massUnit: 'kg' };
const result: BillableWeight = billableWeight({
  actual: { value: '1.2', unit: 'kg' },
  dimensions: { length: 40, width: 30, height: 20, unit: 'cm' },
  divisor,
});
const text: string = convertMass(1, 'lb', 'kg', { scale: 4 });
void [result.billable, text];
