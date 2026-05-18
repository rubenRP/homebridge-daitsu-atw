export default {
  formatTemperature: (high: number, low: number) => {
    return high - 100 + low / 100;
  },
  fieldsToObject: (cols: string[], values: unknown[]): Record<string, unknown> => {
    const obj: Record<string, unknown> = {};
    cols.forEach((key: string, i: number) => {
      obj[key] = values[i];
    });
    return obj;
  },
};
