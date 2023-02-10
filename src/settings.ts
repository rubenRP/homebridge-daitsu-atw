export const PLATFORM_NAME = 'DaitsuATW';
export const ACCESSORY_NAME = 'ATW';
export const PLUGIN_NAME = 'homebridge-daitsu-atw';

//TODO - define config schema
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DEFAULT_DEVICE_CONFIG: any = {};

export const DEFAULT_PLATFORM_CONFIG = {
  name: 'Daitsu ATW',
  port: 7002,
  scanAddress: '192.168.1.255',
  scanCount: 10,
  scanTimeout: 3000,
  defaultValue: DEFAULT_DEVICE_CONFIG,
  statusUpdateInterval: 60,
};

export const UDP_SCAN_PORT = 7000;
