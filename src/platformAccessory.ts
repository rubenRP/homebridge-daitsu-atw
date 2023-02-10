import { Socket } from 'dgram';
import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import commands from './commands';
import crypto from './crypto';

import { DaitsuPlatform } from './platform';
import { DEFAULT_PLATFORM_CONFIG } from './settings';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DaitsuATW {
  private service: Service;

  private key: string | undefined;
  public socket: Socket;
  private binded: boolean;
  private isPending: boolean;
  private updateTimer: NodeJS.Timeout | undefined;
  private cols: Array<string> | undefined;
  private status: Record<string, unknown>;

  constructor(
    public readonly platform: DaitsuPlatform,
    public readonly accessory: PlatformAccessory,
    private readonly deviceConfig: any,
  ) {
    this.socket = platform.socket;
    this.binded = false;
    this.isPending = false;
    this.key = undefined;
    this.status = {};
    // register event handler
    this.socket.on('message', this.handleMessage);
    // try to bind device;
    this.sendBindRequest();
    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.Characteristic.Manufacturer,
        this.accessory.context.device.brand,
      )
      .setCharacteristic(
        this.platform.Characteristic.Model,
        this.accessory.context.device.name ||
          this.accessory.context.device.model ||
          'Daitsu',
      )
      .setCharacteristic(this.platform.Characteristic.Name, this.getName())
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        this.accessory.context.device.mac,
      )
      .setCharacteristic(
        this.platform.Characteristic.FirmwareRevision,
        this.accessory.context.device.ver,
      );

    this.service =
      this.accessory.getService('Thermostat') ||
      this.accessory.addService(this.platform.Service.Thermostat, 'Thermostat');

    this.service
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .updateValue(20)
      .on(
        'get',
        this.getCharacteristic.bind(this, 'heaterCoolerTargetTemperature'),
      );

    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .updateValue(20)
      .on(
        'get',
        this.getCharacteristic.bind(this, 'heaterCoolerCurrentTemperature'),
      );

    this.service
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .updateValue(0)
      .on('get', this.getCharacteristic.bind(this, 'heaterCoolerTargetState'));
  }

  getCharacteristic(key, callback) {
    const value = this[key];
    this.platform.log.debug(
      `[${this.getDeviceLabel()}] Get characteristic: ${key}, value: ${value}`,
    );
    if (value === null || value !== value) {
      callback(new Error(`Failed to get characteristic value for key: ${key}`));
    } else {
      callback(null, value);
    }
  }

  setCharacteristic(key, value: CharacteristicValue, callback) {
    this.platform.log.debug(
      `[${this.getDeviceLabel()}] Set characteristic: ${key} to value: ${value}`,
    );
    this[key] = value;
    callback(null);
  }

  sendMessage(message) {
    const pack = crypto.encrypt(message, this.key);
    const payload = {
      cid: 'app',
      i: this.key === undefined ? 1 : 0,
      t: 'pack',
      uid: 0,
      tcid: this.getMac(),
      pack,
    };
    try {
      this.platform.socket.send(
        JSON.stringify(payload),
        this.getPort(),
        this.getAddress(),
      );
    } catch (err) {
      this.platform.log.error(err as string);
    }
  }

  handleMessage = (msg, rinfo) => {
    if (this.getAddress() === rinfo.address) {
      const message = JSON.parse(msg.toString());
      // this.platform.log.debug(`[${this.getDeviceLabel()}] handle message: %j`, message);
      const pack = crypto.decrypt(
        message.pack,
        message.i === 1 ? undefined : this.key,
      );
      this.platform.log.debug('[DaitsuATW] handle message: %j', pack.t);
      switch (pack.t) {
        case 'bindok':
          this.key = pack.key;
          this.binded = true;
          this.platform.log.info(
            `[${this.getDeviceLabel()}] Device binded. ${this.key}`,
          );
          this.afterBinded();
          break;
        case 'dat': // update status
          this.updateStatus(fieldsToObject(pack.cols, pack.dat));
          break;
        case 'res': // command response
          this.updateStatus(fieldsToObject(pack.opt, pack.p || pack.val));
          break;
        case 'dev':
          break;
        default:
          this.platform.log.debug(pack);
      }
    }
  };

  sendBindRequest() {
    const message = {
      mac: this.getMac(),
      t: 'bind',
      uid: 0,
    };
    this.platform.log.debug(`Bind to device: ${this.getMac()}`);
    this.sendMessage(message);
  }

  requestDeviceStatus() {
    this.platform.log.debug(`[${this.getDeviceLabel()}] requestDeviceStatus`);
    const message = {
      mac: this.getMac(),
      t: 'status',
      cols: [
        commands.power.code,
        commands.mode.code,
        commands.temperatureUnit.code,
        commands.coolingWaterOutTempSet.code,
        commands.heatingWaterOutTempSet.code,
        commands.hepOutWaterTempHigh.code,
        commands.hepOutWaterTempLow.code,
        commands.waterBoxTempHigh.code,
        commands.waterBoxTempLow.code,
        commands.waterBoxTempSet.code,
        commands.temperatureRecovery.code,
        commands.allError.code,
        commands.waterBoxElectricHeaterRunStatus.code,
        commands.systemAntiFrostRunStatus.code,
        commands.electricHeater1RunStatus.code,
        commands.electricHeater2RunStatus.code,
        commands.hpAntiFreeze.code,
      ],
    };
    this.sendMessage(message);
  }

  formatTemperature(high, low) {
    return high - 100 + low / 100;
  }

  get power() {
    return this.status[commands.power.code] === commands.power.value.on;
  }

  get heaterCoolerState() {
    // Check if fan and heating pump is on or off
    return;
  }

  get heaterCoolerTargetState() {
    if (!this.power) {
      return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    }

    switch (this.status[commands.mode.code]) {
      case commands.mode.value.cool:
      case commands.mode.value.coolHotWater:
        return this.platform.Characteristic.TargetHeatingCoolingState.COOL;
      case commands.mode.value.heat:
      case commands.mode.value.heatHotWater:
        return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
      default:
        return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    }
  }

  get heaterCoolerTargetTemperature() {
    switch (this.status[commands.mode.code]) {
      case commands.mode.value.cool:
      case commands.mode.value.coolHotWater:
        return this.status[commands.coolingWaterOutTempSet.code];
      case commands.mode.value.heat:
      case commands.mode.value.heatHotWater:
        return this.status[commands.heatingWaterOutTempSet.code];
      default:
        return 0;
    }
  }

  get heaterCoolerCurrentState() {
    return 0;
  }

  get heaterCoolerCurrentTemperature() {
    if (
      !this.status[commands.hepOutWaterTempHigh.code] ||
      !this.status[commands.hepOutWaterTempLow.code]
    ) {
      return -1;
    }
    return this.formatTemperature(
      this.status[commands.hepOutWaterTempHigh.code],
      this.status[commands.hepOutWaterTempLow.code],
    );
  }

  get waterHeaterTargetTemperature() {
    return this.status[commands.waterBoxTempSet.code];
  }

  get waterHeaterCurrentTemperature() {
    if (
      !this.status[commands.waterBoxTempHigh.code] ||
      !this.status[commands.waterBoxTempLow.code]
    ) {
      return -1;
    }
    return this.formatTemperature(
      this.status[commands.waterBoxTempHigh.code],
      this.status[commands.waterBoxTempLow.code],
    );
  }

  updateStatus(patch) {
    this.platform.log.info(
      `[${this.getDeviceLabel()}] Update Status: %j`,
      patch,
    );
    this.status = {
      ...this.status,
      ...patch,
    };
    this.isPending = false;

    if (patch[commands.power.code] !== undefined) {
      this.service
        .getCharacteristic(
          this.platform.Characteristic.TargetHeatingCoolingState,
        )
        .updateValue(this.heaterCoolerTargetState);
      this.service
        .getCharacteristic(this.platform.Characteristic.TargetTemperature)
        .updateValue(this.heaterCoolerTargetTemperature as number);
      this.service
        .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .updateValue(this.heaterCoolerCurrentTemperature);
    }
  }

  afterBinded() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }
    this.requestDeviceStatus();
    this.updateTimer = setInterval(() => {
      this.requestDeviceStatus();
    }, this.getConfig('statusUpdateInterval') * 1000);
  }

  getMac() {
    return this.accessory.context.device.mac;
  }

  getAddress() {
    return this.accessory.context.device.address;
  }

  getPort() {
    return this.accessory.context.device.port;
  }

  getName() {
    return this.deviceConfig?.name || this.accessory.context.device.name;
  }

  getCols() {
    // TODO: may config features based on some static database;
    if (!this.cols) {
      this.platform.log.info(`Cols Received: ${this.cols}`);
      this.cols = Object.keys(commands).map((k) => commands[k].code);
    }
    return this.cols;
  }

  getConfig(key) {
    return (
      this.deviceConfig?.[key] ??
      this.platform.config.defaultValue?.[key] ??
      DEFAULT_PLATFORM_CONFIG[key]
    );
  }

  getDeviceLabel() {
    return `${this.getMac()} -- ${this.getAddress()}:${this.getPort()}`;
  }
}

function fieldsToObject(cols: any, values: any): any {
  const obj = {};
  cols.forEach((key, i) => {
    obj[key] = values[i];
  });
  return obj;
}
