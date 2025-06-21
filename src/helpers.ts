export default {
  formatTemperature: (high: number, low: number) => {
    return high - 100 + low / 100;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fieldsToObject: (cols: any, values: any): any => {
    const obj: Record<string, any> = {};
    cols.forEach((key: string, i: number) => {
      obj[key] = values[i];
    });
    return obj;
  },
};
