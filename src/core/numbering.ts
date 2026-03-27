export class WormNumbering {
  private numberToId = new Map<number, string>();
  private idToNumber = new Map<string, number>();
  private nextNumber = 1;

  assign(wormId: string): number {
    const num = this.nextNumber++;
    this.numberToId.set(num, wormId);
    this.idToNumber.set(wormId, num);
    return num;
  }

  remove(wormId: string): void {
    const num = this.idToNumber.get(wormId);
    if (num !== undefined) {
      this.numberToId.delete(num);
      this.idToNumber.delete(wormId);
    }
  }

  getByNumber(n: number): string | undefined {
    return this.numberToId.get(n);
  }

  getNumber(wormId: string): number | undefined {
    return this.idToNumber.get(wormId);
  }

  reset(): void {
    this.numberToId.clear();
    this.idToNumber.clear();
    this.nextNumber = 1;
  }
}
