import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import dgram from 'dgram';

import {
  PLATFORM_NAME,
  PLUGIN_NAME,
  DEFAULT_DEVICE_CONFIG,
  DEFAULT_PLATFORM_CONFIG,
  UDP_SCAN_PORT,
} from './settings';
import { DaitsuATW } from './platformAccessory';
import crypto from './crypto';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class DaitsuPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic =
    this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  socket: dgram.Socket;
  devices: Record<string, PlatformAccessory>;
  initializedDevices: Record<string, boolean>;
  scanCount: number;
  timer: NodeJS.Timeout | undefined;
  // messages: any;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.socket = dgram.createSocket('udp4');
    this.devices = {};
    this.initializedDevices = {};
    this.config = {
      ...DEFAULT_PLATFORM_CONFIG,
      ...config,
      defaultValue: {
        ...DEFAULT_DEVICE_CONFIG,
        ...(config.defaultValue || {}),
      },
    };
    this.scanCount = 0;

    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      this.socket.on('message', this.handleMessage);
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  broadcastScan() {
    const message = Buffer.from(JSON.stringify({ t: 'scan' }));
    this.socket.send(
      message,
      0,
      message.length,
      UDP_SCAN_PORT,
      this.config.scanAddress,
      () => {
        this.log.debug(
          `Broadcast '${message}' ${this.config.scanAddress}:${UDP_SCAN_PORT}`,
        );
      },
    );
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info(
      'Loading accessory from cache:',
      accessory.displayName,
      accessory.context.device,
    );

    this.log.debug('configureAccessory', accessory.context);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    if (accessory.context.device?.mac) {
      this.devices[accessory.context.device.mac] = accessory;
    }
  }

  discoverDevices() {
    this.socket.bind(this.config.port, () => {
      this.log.info(`UDP server bind to ${this.config.port}`);
      this.socket.setBroadcast(true);
      this.timer = setInterval(() => {
        this.broadcastScan();
        this.scanCount += 1;
        if (this.scanCount > this.config.scanCount && this.timer) {
          this.log.info('Scan finished.');
          clearInterval(this.timer);
        }
      }, this.config.scanTimeout);
    });
  }

  handleMessage = (msg, rinfo) => {
    this.log.debug('handleMessage', msg.toString());
    try {
      const message = JSON.parse(msg.toString());
      if (message.i !== 1 || message.t !== 'pack') {
        return;
      }
      const pack = crypto.decrypt(message.pack);
      if (message.t === 'pack' && pack.t === 'dev') {
        this.registerDevice({
          ...pack,
          address: rinfo.address,
          port: rinfo.port,
          name: this.config.platform,
        });
      }
    } catch (err) {
      this.log.error('handleMessage Error', err);
    }
  };

  registerDevice = (deviceInfo) => {
    const deviceConfig = this.config;
    let accessory = this.devices[deviceInfo.mac];

    if (accessory && this.initializedDevices[accessory.UUID]) {
      return;
    }

    if (!accessory) {
      const deviceName = deviceInfo.name;
      this.log.debug(
        `Initializing new accessory ${deviceInfo.mac} with name ${deviceName}...`,
      );
      this.log.debug('Before hap.uuid.generate');
      const uuid = this.api.hap.uuid.generate(deviceInfo.mac);
      this.log.debug('After hap.uuid.generate');
      this.log.debug('Before new this.api.platformAccessory');
      accessory = new this.api.platformAccessory(deviceInfo.mac, uuid);
      this.log.debug('After new this.api.platformAccessory');

      this.devices[deviceInfo.mac] = accessory;
      this.log.debug('Before this.api.registerPlatformAccessories');
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory,
      ]);
      this.log.debug('After this.api.registerPlatformAccessories');
    }

    if (accessory) {
      // mark devices as initialized.
      accessory.context.device = deviceInfo;
      this.initializedDevices[accessory.UUID] = true;
      this.scanCount = this.config.scanCount;
      return new DaitsuATW(this, accessory, deviceConfig);
    }
  };
}
