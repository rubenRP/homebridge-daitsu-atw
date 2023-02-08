import { Socket } from "dgram";
import { PlatformAccessory, Service } from "homebridge";
import commands from "./commands";
import crypto from "./crypto";

import { DaitsuPlatform } from "./platform";
import { DEFAULT_PLATFORM_CONFIG } from "./settings";

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DaitsuATW {
  private HeaterCoolerThermostat: Service;

  private key: string | undefined;
  public socket: Socket;
  private binded: boolean;
  private isPending: boolean;
  private updateTimer: NodeJS.Timeout | undefined;
  private cols: Array<string> | undefined;
  private status: Record<string, unknown>;

  constructor(
    public readonly platform: DaitsuPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly deviceConfig: any
  ) {
    this.socket = platform.socket;
    this.binded = false;
    this.isPending = false;
    this.key = undefined;
    this.status = {};
    // register event handler
    this.socket.on("message", this.handleMessage);
    // try to bind device;
    this.sendBindRequest();
    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.Characteristic.Manufacturer,
        this.accessory.context.device.brand
      )
      .setCharacteristic(
        this.platform.Characteristic.Model,
        this.accessory.context.device.name ||
          this.accessory.context.device.model ||
          "Daitsu"
      )
      .setCharacteristic(this.platform.Characteristic.Name, this.getName())
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        this.accessory.context.device.mac
      )
      .setCharacteristic(
        this.platform.Characteristic.FirmwareRevision,
        this.accessory.context.device.ver
      );

    this.HeaterCoolerThermostat =
      this.accessory.getService("Mode") ||
      this.accessory.addService(this.platform.Service.HeaterCooler, "Mode");
  }

  sendMessage(message) {
    const pack = crypto.encrypt(message, this.key);
    const payload = {
      cid: "app",
      i: this.key === undefined ? 1 : 0,
      t: "pack",
      uid: 0,
      tcid: this.getMac(),
      pack,
    };
    /* this.platform.log.debug(
      `[${this.getDeviceLabel()}] send request: %j, %j`,
      payload,
      message
    ); */
    try {
      this.platform.socket.send(
        JSON.stringify(payload),
        this.getPort(),
        this.getAddress()
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
        message.i === 1 ? undefined : this.key
      );
      this.platform.log.debug("[DaitsuATW] handle message: %j", pack.t);
      switch (pack.t) {
        case "bindok":
          this.key = pack.key;
          this.binded = true;
          this.platform.log.info(
            `[${this.getDeviceLabel()}] Device binded. ${this.key}`
          );
          this.afterBinded();
          break;
        case "dat": // update status
          this.platform.log.debug("[DaitsuATW] handle message: %j", pack);
          this.updateStatus(fieldsToObject(pack.cols, pack.dat));
          break;
        case "res": // command response
          this.updateStatus(fieldsToObject(pack.opt, pack.p || pack.val));
          break;
        case "dev":
          break;
        default:
          this.platform.log.debug(pack);
      }
    }
  };

  sendBindRequest() {
    const message = {
      mac: this.getMac(),
      t: "bind",
      uid: 0,
    };
    this.platform.log.debug(`Bind to device: ${this.getMac()}`);
    this.sendMessage(message);
  }

  requestDeviceStatus() {
    this.platform.log.debug(`[${this.getDeviceLabel()}] requestDeviceStatus`);
    const message = {
      mac: this.getMac(),
      t: "status",
      cols: this.getCols(),
    };
    this.sendMessage(message);
  }

  updateStatus(patch) {
    this.platform.log.info(
      `[${this.getDeviceLabel()}] Update Status: %j`,
      patch
    );
    this.status = {
      ...this.status,
      ...patch,
    };
    this.isPending = false;
  }

  afterBinded() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }
    this.requestDeviceStatus();
    this.updateTimer = setInterval(() => {
      this.requestDeviceStatus();
    }, this.getConfig("statusUpdateInterval") * 1000);
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
