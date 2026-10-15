// Mock Decimal class for testing
export class Decimal {
  private value: string;

  constructor(value: string | number) {
    this.value = String(value);
  }

  toString(): string {
    return this.value;
  }

  toFixed(places: number): string {
    const num = parseFloat(this.value);
    return num.toFixed(places);
  }
}

// Mock @prisma/client module
export const mockDecimal = Decimal;
