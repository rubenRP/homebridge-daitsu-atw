export const PLATFORM_NAME = 'DaitsuATW';
export const ACCESSORY_NAME = 'ATW';
export const PLUGIN_NAME = 'homebridge-daitsu-atw';

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

  // HomeKit presentation
  climateName: 'Climate',
  enableHotWater: true,
  hotWaterName: 'Hot Water',
  outdoorTemperatureSensor: false,
  outdoorSensorName: 'Outdoor',

  // Setpoint ranges (water temperatures, °C)
  heatingMin: 20,
  heatingMax: 60,
  coolingMin: 7,
  coolingMax: 25,
  hotWaterMin: 30,
  hotWaterMax: 60,

  // Diagnostics: log every changed status field at info level and request
  // extra status columns so unknown parameters can be discovered.
  diagnostics: false,
  extraStatusCols: [] as string[],
};

export const UDP_SCAN_PORT = 7000;

// Seconds between bind attempts while the device is not bound.
export const BIND_RETRY_SECONDS = 10;
// Consecutive unanswered status polls before the device is considered offline.
export const MAX_MISSED_POLLS = 3;
// Delay before re-reading status after sending a command.
export const CONFIRM_STATUS_DELAY_MS = 2000;
