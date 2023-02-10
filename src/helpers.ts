export default {
  formatTemperature: (high, low) => {
    return high - 100 + low / 100;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fieldsToObject: (cols: any, values: any): any => {
    const obj = {};
    cols.forEach((key, i) => {
      obj[key] = values[i];
    });
    return obj;
  },
};
