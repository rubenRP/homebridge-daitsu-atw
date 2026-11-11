import { Socket } from 'dgram';
import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import commands from './commands';
import crypto from './crypto';
import helpers from './helpers';
import { DaitsuPlatform } from './platform';
import {
  BIND_RETRY_SECONDS,
  CONFIRM_STATUS_DELAY_MS,
  DEFAULT_PLATFORM_CONFIG,
  MAX_MISSED_POLLS,
} from './settings';

type SpaceMode = 'heat' | 'cool';

const MODE = commands.mode.value;
const POWER = commands.power.value;

// Columns requested on every status poll.
const STATUS_COLS = [
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
  commands.outdoorTemp.code,
  'TemsSenOut',
  'TemSen',
];

export class DaitsuATW {
  public socket: Socket;

  private climateService: Service;
  private hotWaterService: Service | undefined;
  private outdoorService: Service | undefined;

  private key: string | undefined;
  private binded = false;
  private status: Record<string, unknown> = {};
  private hasStatus = false;
  private missedPolls = 0;
  private offline = false;
  private faultLogged = false;
  private unitWarningLogged = false;

  private bindTimer: NodeJS.Timeout | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private confirmTimer: NodeJS.Timeout | undefined;

  constructor(
    public readonly platform: DaitsuPlatform,
    public readonly accessory: PlatformAccessory,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly deviceConfig: any,
  ) {
    this.socket = platform.socket;

    this.setupAccessoryInformation();
    this.climateService = this.setupClimateService();
    this.hotWaterService = this.setupHotWaterService();
    this.outdoorService = this.setupOutdoorService();

    this.socket.on('message', this.handleMessage);
    this.startBinding();
  }

  // ---------------------------------------------------------------------------
  // HomeKit services
  // ---------------------------------------------------------------------------

  private get C() {
    return this.platform.Characteristic;
  }

  private setupAccessoryInformation() {
    const device = this.accessory.context.device;
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.C.Manufacturer, device.brand || 'Daitsu')
      .setCharacteristic(this.C.Model, device.model || device.name || 'ATW')
      .setCharacteristic(this.C.Name, this.getName())
      .setCharacteristic(this.C.SerialNumber, device.mac)
      .setCharacteristic(this.C.FirmwareRevision, device.ver || '0');
  }

  private setupClimateService(): Service {
    const name = this.getConfig('climateName');
    // Keep the original service (displayName "Thermostat") so existing HomeKit
    // automations and room assignments survive the upgrade.
    const service =
      this.accessory.getService('Thermostat') ||
      this.accessory.addService(this.platform.Service.Thermostat, 'Thermostat');
    service.setPrimaryService(true);
    this.setServiceName(service, name);
    service.addOptionalCharacteristic(this.C.StatusFault);

    const range = this.climateRange();
    service
      .getCharacteristic(this.C.TargetHeatingCoolingState)
      .setProps({
        validValues: [
          this.C.TargetHeatingCoolingState.OFF,
          this.C.TargetHeatingCoolingState.HEAT,
          this.C.TargetHeatingCoolingState.COOL,
        ],
      })
      .onGet(() => this.read(service, this.C.TargetHeatingCoolingState, this.climateTargetState))
      .onSet((value) => this.setClimateState(value));

    service
      .getCharacteristic(this.C.CurrentHeatingCoolingState)
      .onGet(() => this.read(service, this.C.CurrentHeatingCoolingState, this.climateCurrentState));

    this.initTargetTemperature(service, range.min, range.max)
      .onGet(() => this.read(service, this.C.TargetTemperature, this.climateTargetTemperature))
      .onSet((value) => this.setClimateTemperature(value));

    this.initCurrentTemperature(service)
      .onGet(() => this.read(service, this.C.CurrentTemperature, this.waterOutTemperature));

    service
      .getCharacteristic(this.C.StatusFault)
      .onGet(() => this.read(service, this.C.StatusFault, this.faultStatus));

    return service;
  }

  private setupHotWaterService(): Service | undefined {
    const existing = this.accessory.getServiceById(this.platform.Service.Thermostat, 'hotWater');
    if (!this.getConfig('enableHotWater')) {
      if (existing) {
        this.accessory.removeService(existing);
      }
      return undefined;
    }

    const name = this.getConfig('hotWaterName');
    const service =
      existing || this.accessory.addService(this.platform.Service.Thermostat, name, 'hotWater');
    this.setServiceName(service, name);
    service.addOptionalCharacteristic(this.C.StatusFault);

    service
      .getCharacteristic(this.C.TargetHeatingCoolingState)
      .setProps({
        validValues: [
          this.C.TargetHeatingCoolingState.OFF,
          this.C.TargetHeatingCoolingState.HEAT,
        ],
      })
      .onGet(() => this.read(service, this.C.TargetHeatingCoolingState, this.hotWaterTargetState))
      .onSet((value) => this.setHotWaterState(value));

    service
      .getCharacteristic(this.C.CurrentHeatingCoolingState)
      .setProps({
        validValues: [
          this.C.CurrentHeatingCoolingState.OFF,
          this.C.CurrentHeatingCoolingState.HEAT,
        ],
      })
      .onGet(() => this.read(service, this.C.CurrentHeatingCoolingState, this.hotWaterCurrentState));

    this.initTargetTemperature(service, this.getConfig('hotWaterMin'), this.getConfig('hotWaterMax'))
      .onGet(() => this.read(service, this.C.TargetTemperature, this.hotWaterTargetTemperature))
      .onSet((value) => this.setHotWaterTemperature(value));

    this.initCurrentTemperature(service)
      .onGet(() => this.read(service, this.C.CurrentTemperature, this.tankTemperature));

    service
      .getCharacteristic(this.C.StatusFault)
      .onGet(() => this.read(service, this.C.StatusFault, this.faultStatus));

    return service;
  }

  private setupOutdoorService(): Service | undefined {
    const existing = this.accessory.getServiceById(
      this.platform.Service.TemperatureSensor,
      'outdoor',
    );
    if (!this.getConfig('outdoorTemperatureSensor')) {
      if (existing) {
        this.accessory.removeService(existing);
      }
      return undefined;
    }

    const name = this.getConfig('outdoorSensorName');
    const service =
      existing ||
      this.accessory.addService(this.platform.Service.TemperatureSensor, name, 'outdoor');
    this.setServiceName(service, name);
    this.initCurrentTemperature(service)
      .onGet(() => this.read(service, this.C.CurrentTemperature, this.outdoorTemperature));
    return service;
  }

  /**
   * Sets the service name. ConfiguredName is what the Home app shows for each
   * service of a multi-service accessory; it is only initialised once so a
   * rename done in the Home app is kept.
   */
  private setServiceName(service: Service, name: string) {
    service.setCharacteristic(this.C.Name, name);
    service.addOptionalCharacteristic(this.C.ConfiguredName);
    const configuredName = service.getCharacteristic(this.C.ConfiguredName);
    if (!configuredName.value) {
      configuredName.updateValue(name);
    }
  }

  private initTargetTemperature(service: Service, minValue: number, maxValue: number) {
    const characteristic = service.getCharacteristic(this.C.TargetTemperature);
    const current = characteristic.value;
    const value =
      typeof current === 'number' ? helpers.clamp(current, minValue, maxValue) : minValue;
    // Widen the range first so neither the old nor the new value is rejected.
    characteristic.setProps({
      minValue: Math.min(minValue, characteristic.props.minValue ?? minValue),
      maxValue: Math.max(maxValue, characteristic.props.maxValue ?? maxValue),
    });
    characteristic.updateValue(value);
    characteristic.setProps({ minValue, maxValue, minStep: 1 });
    return characteristic;
  }

  private initCurrentTemperature(service: Service) {
    return service
      .getCharacteristic(this.C.CurrentTemperature)
      .setProps({ minValue: -50, maxValue: 100, minStep: 0.1 });
  }

  /**
   * Returns the computed value for a characteristic. Before the first status
   * arrives it falls back to the cached value. When the device is offline it
   * raises "No Response" so HomeKit does not show stale data.
   */
  private read(
    service: Service,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    characteristic: any,
    value: CharacteristicValue | undefined,
  ): CharacteristicValue {
    if (this.offline) {
      throw this.communicationError();
    }
    return value ?? service.getCharacteristic(characteristic).value ?? 0;
  }

  /** Pushes every computed value to HomeKit. */
  private refreshCharacteristics() {
    const climate = this.climateService;
    this.push(climate, this.C.TargetHeatingCoolingState, this.climateTargetState);
    this.push(climate, this.C.CurrentHeatingCoolingState, this.climateCurrentState);
    this.push(climate, this.C.TargetTemperature, this.climateTargetTemperature);
    this.push(climate, this.C.CurrentTemperature, this.waterOutTemperature);
    this.push(climate, this.C.StatusFault, this.faultStatus);

    const hotWater = this.hotWaterService;
    if (hotWater) {
      this.push(hotWater, this.C.TargetHeatingCoolingState, this.hotWaterTargetState);
      this.push(hotWater, this.C.CurrentHeatingCoolingState, this.hotWaterCurrentState);
      this.push(hotWater, this.C.TargetTemperature, this.hotWaterTargetTemperature);
      this.push(hotWater, this.C.CurrentTemperature, this.tankTemperature);
      this.push(hotWater, this.C.StatusFault, this.faultStatus);
    }

    if (this.outdoorService) {
      this.push(this.outdoorService, this.C.CurrentTemperature, this.outdoorTemperature);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private push(service: Service, characteristic: any, value: CharacteristicValue | undefined) {
    if (value !== undefined) {
      service.getCharacteristic(characteristic).updateValue(value);
    }
  }

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  private get power(): boolean {
    return this.status[commands.power.code] === POWER.on;
  }

  private get mode(): number | undefined {
    const mode = this.status[commands.mode.code];
    return typeof mode === 'number' ? mode : undefined;
  }

  /** Space heating/cooling mode selected on the device, ignoring power. */
  private get selectedSpaceMode(): SpaceMode | undefined {
    switch (this.mode) {
    case MODE.heat:
    case MODE.heatHotWater:
      return 'heat';
    case MODE.cool:
    case MODE.coolHotWater:
      return 'cool';
    default:
      return undefined;
    }
  }

  /** Space mode used for setpoints: the selected one, or the last one used. */
  private get setpointSpaceMode(): SpaceMode {
    return this.selectedSpaceMode ?? this.accessory.context.lastSpaceMode ?? 'heat';
  }

  private get hotWaterSelected(): boolean {
    return (
      this.mode === MODE.hotWater ||
      this.mode === MODE.heatHotWater ||
      this.mode === MODE.coolHotWater
    );
  }

  private get climateActive(): boolean {
    return this.power && this.selectedSpaceMode !== undefined;
  }

  private get hotWaterActive(): boolean {
    return this.power && this.hotWaterSelected;
  }

  private get climateTargetState(): number | undefined {
    if (!this.hasStatus) {
      return undefined;
    }
    const state = this.C.TargetHeatingCoolingState;
    if (!this.climateActive) {
      return state.OFF;
    }
    return this.selectedSpaceMode === 'cool' ? state.COOL : state.HEAT;
  }

  private get climateCurrentState(): number | undefined {
    if (!this.hasStatus) {
      return undefined;
    }
    const state = this.C.CurrentHeatingCoolingState;
    if (!this.climateActive) {
      return state.OFF;
    }
    const current = this.waterOutTemperature;
    const target = this.climateTargetTemperature;
    if (this.selectedSpaceMode === 'cool') {
      return current !== undefined && target !== undefined && current <= target
        ? state.OFF
        : state.COOL;
    }
    const heaterRunning =
      this.isOn(commands.electricHeater1RunStatus.code) ||
      this.isOn(commands.electricHeater2RunStatus.code);
    return heaterRunning || current === undefined || target === undefined || current < target
      ? state.HEAT
      : state.OFF;
  }

  private get climateTargetTemperature(): number | undefined {
    const code =
      this.setpointSpaceMode === 'cool'
        ? commands.coolingWaterOutTempSet.code
        : commands.heatingWaterOutTempSet.code;
    const value = this.status[code];
    if (typeof value !== 'number') {
      return undefined;
    }
    const range = this.climateRange();
    return helpers.clamp(Math.round(value), range.min, range.max);
  }

  private get hotWaterTargetState(): number | undefined {
    if (!this.hasStatus) {
      return undefined;
    }
    const state = this.C.TargetHeatingCoolingState;
    return this.hotWaterActive ? state.HEAT : state.OFF;
  }

  private get hotWaterCurrentState(): number | undefined {
    if (!this.hasStatus) {
      return undefined;
    }
    const state = this.C.CurrentHeatingCoolingState;
    if (!this.hotWaterActive) {
      return state.OFF;
    }
    const current = this.tankTemperature;
    const target = this.hotWaterTargetTemperature;
    const heaterRunning = this.isOn(commands.waterBoxElectricHeaterRunStatus.code);
    return heaterRunning || current === undefined || target === undefined || current < target
      ? state.HEAT
      : state.OFF;
  }

  private get hotWaterTargetTemperature(): number | undefined {
    const value = this.status[commands.waterBoxTempSet.code];
    if (typeof value !== 'number') {
      return undefined;
    }
    return helpers.clamp(
      Math.round(value),
      this.getConfig('hotWaterMin'),
      this.getConfig('hotWaterMax'),
    );
  }

  private get waterOutTemperature(): number | undefined {
    return this.decodeTemperature(
      commands.hepOutWaterTempHigh.code,
      commands.hepOutWaterTempLow.code,
    );
  }

  private get tankTemperature(): number | undefined {
    return this.decodeTemperature(commands.waterBoxTempHigh.code, commands.waterBoxTempLow.code);
  }

  private get outdoorTemperature(): number | undefined {
    const value = this.status[commands.outdoorTemp.code];
    return typeof value === 'number' ? value : undefined;
  }

  private get faultStatus(): number | undefined {
    if (!this.hasStatus) {
      return undefined;
    }
    return this.isOn(commands.allError.code)
      ? this.C.StatusFault.GENERAL_FAULT
      : this.C.StatusFault.NO_FAULT;
  }

  private decodeTemperature(highCode: string, lowCode: string): number | undefined {
    const high = this.status[highCode];
    const low = this.status[lowCode];
    if (typeof high !== 'number' || typeof low !== 'number' || high === 0) {
      return undefined;
    }
    return Math.round(helpers.formatTemperature(high, low) * 10) / 10;
  }

  private isOn(code: string): boolean {
    const value = this.status[code];
    return typeof value === 'number' && value !== 0;
  }

  private climateRange() {
    return {
      min: Math.min(this.getConfig('heatingMin'), this.getConfig('coolingMin')),
      max: Math.max(this.getConfig('heatingMax'), this.getConfig('coolingMax')),
    };
  }

  // ---------------------------------------------------------------------------
  // HomeKit setters
  // ---------------------------------------------------------------------------

  private setClimateState(value: CharacteristicValue) {
    this.assertOnline();
    const state = this.C.TargetHeatingCoolingState;
    const hotWater = this.hotWaterActive;
    const command: Record<string, number> = {};

    switch (value) {
    case state.OFF:
      if (hotWater) {
        // Keep domestic hot water running; only stop space heating/cooling.
        command[commands.mode.code] = MODE.hotWater;
      } else {
        command[commands.power.code] = POWER.off;
      }
      break;
    case state.HEAT:
      command[commands.power.code] = POWER.on;
      command[commands.mode.code] = hotWater ? MODE.heatHotWater : MODE.heat;
      break;
    case state.COOL:
      command[commands.power.code] = POWER.on;
      command[commands.mode.code] = hotWater ? MODE.coolHotWater : MODE.cool;
      break;
    default:
      throw this.invalidValueError();
    }

    this.platform.log.info(`[${this.getDeviceLabel()}] Climate set to ${this.stateName(value)}`);
    this.applyCommand(command);
  }

  private setHotWaterState(value: CharacteristicValue) {
    this.assertOnline();
    const state = this.C.TargetHeatingCoolingState;
    const spaceMode = this.climateActive ? this.selectedSpaceMode : undefined;
    const command: Record<string, number> = {};

    switch (value) {
    case state.OFF:
      if (spaceMode) {
        // Keep space heating/cooling running; only stop hot water.
        command[commands.mode.code] = spaceMode === 'cool' ? MODE.cool : MODE.heat;
      } else {
        command[commands.power.code] = POWER.off;
      }
      break;
    case state.HEAT:
      command[commands.power.code] = POWER.on;
      command[commands.mode.code] =
        spaceMode === 'cool'
          ? MODE.coolHotWater
          : spaceMode === 'heat'
            ? MODE.heatHotWater
            : MODE.hotWater;
      break;
    default:
      throw this.invalidValueError();
    }

    this.platform.log.info(`[${this.getDeviceLabel()}] Hot water set to ${this.stateName(value)}`);
    this.applyCommand(command);
  }

  private setClimateTemperature(value: CharacteristicValue) {
    this.assertOnline();
    const mode = this.setpointSpaceMode;
    const min = this.getConfig(mode === 'cool' ? 'coolingMin' : 'heatingMin');
    const max = this.getConfig(mode === 'cool' ? 'coolingMax' : 'heatingMax');
    const temperature = helpers.clamp(Math.round(value as number), min, max);
    const code =
      mode === 'cool'
        ? commands.coolingWaterOutTempSet.code
        : commands.heatingWaterOutTempSet.code;

    this.platform.log.info(
      `[${this.getDeviceLabel()}] ${mode === 'cool' ? 'Cooling' : 'Heating'} water setpoint set to ${temperature}°C`,
    );
    this.applyCommand({ [code]: temperature });
  }

  private setHotWaterTemperature(value: CharacteristicValue) {
    this.assertOnline();
    const temperature = helpers.clamp(
      Math.round(value as number),
      this.getConfig('hotWaterMin'),
      this.getConfig('hotWaterMax'),
    );
    this.platform.log.info(
      `[${this.getDeviceLabel()}] Hot water setpoint set to ${temperature}°C`,
    );
    this.applyCommand({ [commands.waterBoxTempSet.code]: temperature });
  }

  /** Optimistically applies a command locally, sends it and re-reads status. */
  private applyCommand(command: Record<string, number>) {
    this.status = { ...this.status, ...command };
    this.rememberSpaceMode();
    this.refreshCharacteristics();
    this.sendCommand(command);

    if (this.confirmTimer) {
      clearTimeout(this.confirmTimer);
    }
    this.confirmTimer = setTimeout(() => this.requestDeviceStatus(), CONFIRM_STATUS_DELAY_MS);
  }

  private assertOnline() {
    if (!this.binded || this.offline) {
      this.platform.log.warn(`[${this.getDeviceLabel()}] Device not reachable, command ignored`);
      throw this.communicationError();
    }
  }

  private communicationError() {
    const { HapStatusError, HAPStatus } = this.platform.api.hap;
    return new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  private invalidValueError() {
    const { HapStatusError, HAPStatus } = this.platform.api.hap;
    return new HapStatusError(HAPStatus.INVALID_VALUE_IN_REQUEST);
  }

  private stateName(value: CharacteristicValue) {
    return ['OFF', 'HEAT', 'COOL', 'AUTO'][value as number] ?? String(value);
  }

  // ---------------------------------------------------------------------------
  // Device protocol
  // ---------------------------------------------------------------------------

  private sendMessage(message: Record<string, unknown>) {
    try {
      const pack = crypto.encrypt(message, this.key);
      const payload = {
        cid: 'app',
        i: this.key === undefined ? 1 : 0,
        t: 'pack',
        uid: 0,
        tcid: this.getMac(),
        pack,
      };
      this.socket.send(JSON.stringify(payload), this.getPort(), this.getAddress());
    } catch (err) {
      this.platform.log.error(`[${this.getDeviceLabel()}] Failed to send message`, err);
    }
  }

  private handleMessage = (msg: Buffer, rinfo: { address: string }) => {
    if (this.getAddress() !== rinfo.address) {
      return;
    }
    try {
      const message = JSON.parse(msg.toString());
      if (message.t !== 'pack' || typeof message.pack !== 'string') {
        return;
      }
      const pack = crypto.decrypt(message.pack, message.i === 1 ? undefined : this.key);
      this.platform.log.debug(`[${this.getDeviceLabel()}] Received: %j`, pack);

      switch (pack.t) {
      case 'bindok':
        this.onBound(pack.key);
        break;
      case 'dat': // status response
        this.updateStatus(helpers.fieldsToObject(pack.cols, pack.dat));
        break;
      case 'res': // command response
        this.updateStatus(helpers.fieldsToObject(pack.opt, pack.p || pack.val));
        break;
      case 'dev': // scan response, handled by the platform
        break;
      default:
        this.platform.log.debug(`[${this.getDeviceLabel()}] Unhandled pack type: ${pack.t}`);
      }
    } catch (err) {
      this.platform.log.warn(`[${this.getDeviceLabel()}] Failed to handle message`, err);
    }
  };

  private startBinding() {
    this.binded = false;
    this.key = undefined;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.bindTimer) {
      clearInterval(this.bindTimer);
    }
    this.sendBindRequest();
    this.bindTimer = setInterval(() => this.sendBindRequest(), BIND_RETRY_SECONDS * 1000);
  }

  private sendBindRequest() {
    this.platform.log.debug(`[${this.getDeviceLabel()}] Sending bind request`);
    this.sendMessage({ mac: this.getMac(), t: 'bind', uid: 0 });
  }

  private onBound(key: string) {
    this.key = key;
    this.binded = true;
    this.missedPolls = 0;
    if (this.bindTimer) {
      clearInterval(this.bindTimer);
      this.bindTimer = undefined;
    }
    this.platform.log.info(`[${this.getDeviceLabel()}] Device bound`);

    this.requestDeviceStatus();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    this.pollTimer = setInterval(() => this.poll(), this.getConfig('statusUpdateInterval') * 1000);
  }

  private poll() {
    if (this.missedPolls >= MAX_MISSED_POLLS) {
      if (!this.offline) {
        this.offline = true;
        this.platform.log.warn(
          `[${this.getDeviceLabel()}] No response after ${this.missedPolls} polls, marking offline and re-binding`,
        );
      }
      this.startBinding();
      return;
    }
    this.missedPolls += 1;
    this.requestDeviceStatus();
  }

  private requestDeviceStatus() {
    const extra: string[] = this.getConfig('extraStatusCols') ?? [];
    const cols = Array.from(new Set([...STATUS_COLS, ...extra]));
    this.platform.log.debug(`[${this.getDeviceLabel()}] Requesting status`);
    this.sendMessage({ mac: this.getMac(), t: 'status', cols });
  }

  private sendCommand(command: Record<string, number>) {
    this.platform.log.debug(`[${this.getDeviceLabel()}] Sending command: %j`, command);
    this.sendMessage({
      mac: this.getMac(),
      t: 'cmd',
      opt: Object.keys(command),
      p: Object.values(command),
    });
  }

  private updateStatus(patch: Record<string, unknown>) {
    const changes = Object.entries(patch).filter(([key, value]) => this.status[key] !== value);
    if (changes.length > 0) {
      const level = this.getConfig('diagnostics') ? 'info' : 'debug';
      this.platform.log[level](
        `[${this.getDeviceLabel()}] Status changed: %j`,
        Object.fromEntries(changes),
      );
    }

    this.status = { ...this.status, ...patch };
    this.hasStatus = true;
    this.missedPolls = 0;
    if (this.offline) {
      this.offline = false;
      this.platform.log.info(`[${this.getDeviceLabel()}] Device back online`);
    }

    this.rememberSpaceMode();
    this.checkWarnings();
    this.refreshCharacteristics();
  }

  private rememberSpaceMode() {
    const mode = this.selectedSpaceMode;
    if (mode) {
      this.accessory.context.lastSpaceMode = mode;
    }
  }

  private checkWarnings() {
    const fault = this.isOn(commands.allError.code);
    if (fault && !this.faultLogged) {
      this.platform.log.warn(
        `[${this.getDeviceLabel()}] Device reports an error (AllErr=${this.status[commands.allError.code]})`,
      );
    }
    this.faultLogged = fault;

    if (
      this.status[commands.temperatureUnit.code] === commands.temperatureUnit.value.fahrenheit &&
      !this.unitWarningLogged
    ) {
      this.unitWarningLogged = true;
      this.platform.log.warn(
        `[${this.getDeviceLabel()}] Device display unit is Fahrenheit; temperatures are assumed to be reported in °C`,
      );
    }
  }

  /** Stops timers and listeners (called on Homebridge shutdown). */
  dispose() {
    clearInterval(this.bindTimer);
    clearInterval(this.pollTimer);
    clearTimeout(this.confirmTimer);
    this.socket.off('message', this.handleMessage);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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
    return this.deviceConfig?.name || this.accessory.context.device.name || 'Daitsu ATW';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getConfig(key: string): any {
    return (
      this.deviceConfig?.[key] ??
      this.platform.config.defaultValue?.[key] ??
      DEFAULT_PLATFORM_CONFIG[key as keyof typeof DEFAULT_PLATFORM_CONFIG]
    );
  }

  getDeviceLabel() {
    return `${this.getMac()} -- ${this.getAddress()}:${this.getPort()}`;
  }
}
