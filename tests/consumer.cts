import { dimensionalNanograms, ShippingError, MASS_UNITS } from '@lp-labs/shipping-weight';

const grams: bigint = dimensionalNanograms(
  { length: 10, width: 10, height: 10, unit: 'cm' },
  { volume: 5000, lengthUnit: 'cm', mass: 1, massUnit: 'kg' },
);
const code: string = new ShippingError('invalid-input', 'x').code;
void [grams, code, MASS_UNITS.kg];
