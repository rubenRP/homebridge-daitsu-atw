import { Socket } from 'dgram';
import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import commands from './commands';
import crypto from './crypto';
import helpers from './helpers';
import { DaitsuPlatform } from './platform';
import { DEFAULT_PLATFORM_CONFIG } from './settings';

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      .setProps({
        minValue: 5,
        maxValue: 35,
        minStep: 1,
      })
      .on(
        'get',
        this.getCharacteristic.bind(this, 'heaterCoolerTargetTemperature'),
      )
      .on('set', this.setTargetTemperature.bind(this));

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
      .on('get', this.getCharacteristic.bind(this, 'heaterCoolerTargetState'))
      .on('set', this.setTargetHeatingCoolingState.bind(this));
  }

  getCharacteristic(
    key: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (error?: Error | null, value?: any) => void,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = this[key as keyof this] as any;
    this.platform.log.debug(
      `[${this.getDeviceLabel()}] Get characteristic: ${key}, value: ${value}`,
    );
    if (value === null || value !== value) {
      callback(new Error(`Failed to get characteristic value for key: ${key}`));
    } else {
      callback(null, value);
    }
  }

  setCharacteristic(
    key: string,
    value: CharacteristicValue,
    callback: (error?: Error | null) => void,
  ) {
    this.platform.log.debug(
      `[${this.getDeviceLabel()}] Set characteristic: ${key} to value: ${value}`,
    );
    // Store the value in the status object
    this.status[key] = value;
    callback(null);
  }

  sendMessage(message: Record<string, unknown>) {
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

  handleMessage = (msg: Buffer, rinfo: { address: string }) => {
    if (this.getAddress() === rinfo.address) {
      const message = JSON.parse(msg.toString());
      this.platform.log.debug(
        `[${this.getDeviceLabel()}] handle message: %j`,
        message,
      );
      const pack = crypto.decrypt(
        message.pack,
        message.i === 1 ? undefined : this.key,
      );
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
          this.updateStatus(helpers.fieldsToObject(pack.cols, pack.dat));
          break;
        case 'res': // command response
          this.updateStatus(
            helpers.fieldsToObject(pack.opt, pack.p || pack.val),
          );
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
        'OutEnvTem',
        'TemsSenOut',
        'TemSen',
      ],
    };
    this.sendMessage(message);
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
    let temperature: number;
    switch (this.status[commands.mode.code]) {
      case commands.mode.value.cool:
      case commands.mode.value.coolHotWater:
        temperature = this.status[
          commands.coolingWaterOutTempSet.code
        ] as number;
        break;
      case commands.mode.value.heat:
      case commands.mode.value.heatHotWater:
        temperature = this.status[
          commands.heatingWaterOutTempSet.code
        ] as number;
        break;
      default:
        return 20;
    }

    // Always return rounded temperature
    return temperature ? Math.round(temperature) : 20;
  }

  get heaterCoolerCurrentState() {
    return 0;
  }

  get heaterCoolerCurrentTemperature() {
    if (
      !this.status[commands.hepOutWaterTempHigh.code] ||
      !this.status[commands.hepOutWaterTempLow.code]
    ) {
      return 20;
    }
    const temperature = helpers.formatTemperature(
      this.status[commands.hepOutWaterTempHigh.code] as number,
      this.status[commands.hepOutWaterTempLow.code] as number,
    );

    // Always return rounded temperature
    return Math.round(temperature);
  }

  get waterHeaterTargetTemperature() {
    const temperature = this.status[commands.waterBoxTempSet.code] as number;
    return temperature ? Math.round(temperature) : 45;
  }

  get waterHeaterCurrentTemperature() {
    if (
      !this.status[commands.waterBoxTempHigh.code] ||
      !this.status[commands.waterBoxTempLow.code]
    ) {
      return 45;
    }
    const temperature = helpers.formatTemperature(
      this.status[commands.waterBoxTempHigh.code] as number,
      this.status[commands.waterBoxTempLow.code] as number,
    );

    // Always return rounded temperature
    return Math.round(temperature);
  }

  async updateStatus(patch: Record<string, unknown>) {
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
      this.cols = Object.keys(commands).map(
        (k) => commands[k as keyof typeof commands].code,
      );
    }
    return this.cols;
  }

  getConfig(key: string) {
    return (
      this.deviceConfig?.[key] ??
      this.platform.config.defaultValue?.[key] ??
      DEFAULT_PLATFORM_CONFIG[key as keyof typeof DEFAULT_PLATFORM_CONFIG]
    );
  }

  getDeviceLabel() {
    return `${this.getMac()} -- ${this.getAddress()}:${this.getPort()}`;
  }

  setTargetTemperature(
    value: CharacteristicValue,
    callback: (error?: Error | null) => void,
  ) {
    this.platform.log.debug(
      `[${this.getDeviceLabel()}] Set target temperature to: ${value}`,
    );

    const inputTemperature = value as number;
    const roundedTemperature = Math.round(inputTemperature);
    let command: string;

    this.platform.log.debug(
      `[${this.getDeviceLabel()}] Rounded temperature from ${inputTemperature} to ${roundedTemperature}`,
    );

    // Determine which temperature setting to use based on current mode
    switch (this.status[commands.mode.code]) {
      case commands.mode.value.cool:
      case commands.mode.value.coolHotWater:
        command = commands.coolingWaterOutTempSet.code;
        break;
      case commands.mode.value.heat:
      case commands.mode.value.heatHotWater:
        command = commands.heatingWaterOutTempSet.code;
        break;
      default:
        callback(new Error('Cannot set temperature when device is off'));
        return;
    }

    // Update the status immediately to reflect the rounded value
    this.status[command] = roundedTemperature;

    // Update the HomeKit characteristic to show the rounded value
    this.service
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .updateValue(roundedTemperature);

    this.sendCommand({ [command]: roundedTemperature });
    callback(null);
  }

  setTargetHeatingCoolingState(
    value: CharacteristicValue,
    callback: (error?: Error | null) => void,
  ) {
    this.platform.log.debug(
      `[${this.getDeviceLabel()}] Set target heating/cooling state to: ${value}`,
    );

    const state = value as number;
    const commands_to_send: Record<string, number> = {};

    switch (state) {
      case this.platform.Characteristic.TargetHeatingCoolingState.OFF:
        commands_to_send[commands.power.code] = commands.power.value.off;
        break;
      case this.platform.Characteristic.TargetHeatingCoolingState.HEAT:
        commands_to_send[commands.power.code] = commands.power.value.on;
        commands_to_send[commands.mode.code] = commands.mode.value.heat;
        break;
      case this.platform.Characteristic.TargetHeatingCoolingState.COOL:
        commands_to_send[commands.power.code] = commands.power.value.on;
        commands_to_send[commands.mode.code] = commands.mode.value.cool;
        break;
      default:
        callback(new Error(`Unsupported heating/cooling state: ${state}`));
        return;
    }

    this.sendCommand(commands_to_send);
    callback(null);
  }

  sendCommand(commands_to_send: Record<string, number>) {
    if (!this.binded) {
      this.platform.log.warn(
        `[${this.getDeviceLabel()}] Device not binded, cannot send command`,
      );
      return;
    }

    this.platform.log.debug(
      `[${this.getDeviceLabel()}] Sending command: %j`,
      commands_to_send,
    );

    const message = {
      mac: this.getMac(),
      t: 'cmd',
      opt: Object.keys(commands_to_send),
      p: Object.values(commands_to_send),
    };

    this.sendMessage(message);
  }
}
