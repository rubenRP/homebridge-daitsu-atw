import dgram from 'dgram';

import crypto from './crypto';
import { DaitsuATW } from './platformAccessory';
import {
  DEFAULT_DEVICE_CONFIG,
  DEFAULT_PLATFORM_CONFIG,
  PLATFORM_NAME,
  PLUGIN_NAME,
  UDP_SCAN_PORT,
} from './settings';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class DaitsuPlatform {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly Service: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly Characteristic: any;

  // this is used to track restored cached accessories
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly accessories: any[] = [];

  socket: dgram.Socket;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  device: any;
  initializedDevice: boolean;
  scanCount: number;
  timer: NodeJS.Timeout | undefined;
  // messages: any;

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public readonly log: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public readonly config: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public readonly api: any,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.socket = dgram.createSocket('udp4');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.device = {} as any;
    this.initializedDevice = false;
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
    this.log.info(
      '[INIT] Platform configuration:',
      JSON.stringify(this.config, null, 2),
    );

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
    this.log.info(
      `[SCAN ${this.scanCount}] Broadcasting scan message to ${this.config.scanAddress}:${UDP_SCAN_PORT}`,
    );
    this.socket.send(
      message,
      0,
      message.length,
      UDP_SCAN_PORT,
      this.config.scanAddress,
      (error) => {
        if (error) {
          this.log.error(`[SCAN ${this.scanCount}] Broadcast failed:`, error);
        } else {
          this.log.debug(
            `[SCAN ${this.scanCount}] Broadcast sent successfully: '${message}' to ${this.config.scanAddress}:${UDP_SCAN_PORT}`,
          );
        }
      },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configureAccessory(accessory: any) {
    this.log.info(
      'Loading accessory from cache:',
      accessory.displayName,
      accessory.context.device,
    );

    this.log.debug('configureAccessory', accessory.context);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    if (accessory.context.device?.mac) {
      this.device = accessory;
    }
  }

  discoverDevices() {
    this.log.info('[DISCOVERY] Starting device discovery...');
    this.log.info(
      `[DISCOVERY] Config - port: ${this.config.port}, scanAddress: ${this.config.scanAddress}, ` +
        `scanCount: ${this.config.scanCount}, scanTimeout: ${this.config.scanTimeout}ms`,
    );

    this.socket.bind(this.config.port, () => {
      this.log.info(
        `[DISCOVERY] UDP server successfully bound to port ${this.config.port}`,
      );
      this.socket.setBroadcast(true);
      this.log.info('[DISCOVERY] Broadcast mode enabled');

      this.timer = setInterval(() => {
        this.broadcastScan();
        this.scanCount += 1;
        this.log.debug(
          `[DISCOVERY] Scan attempt ${this.scanCount}/${this.config.scanCount}`,
        );

        if (this.scanCount > this.config.scanCount && this.timer) {
          this.log.info(
            `[DISCOVERY] Scan finished. Completed ${this.scanCount} attempts without finding devices.`,
          );
          clearInterval(this.timer);
        }
      }, this.config.scanTimeout);
    });

    this.socket.on('error', (error) => {
      this.log.error('[DISCOVERY] Socket error:', error);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleMessage = (msg: Buffer, rinfo: any) => {
    this.log.info(
      `[MESSAGE] Received message from ${rinfo.address}:${rinfo.port}`,
    );
    this.log.debug(`[MESSAGE] Raw message: ${msg.toString()}`);

    try {
      const message = JSON.parse(msg.toString());
      this.log.debug('[MESSAGE] Parsed message:', message);

      if (message.i !== 1) {
        this.log.debug(
          `[MESSAGE] Ignoring message with i=${message.i} (expected i=1)`,
        );
        return;
      }

      if (message.t !== 'pack') {
        this.log.debug(
          `[MESSAGE] Ignoring message with t='${message.t}' (expected t='pack')`,
        );
        return;
      }

      this.log.debug('[MESSAGE] Processing pack message...');
      const pack = crypto.decrypt(message.pack);
      this.log.debug('[MESSAGE] Decrypted pack:', pack);

      if (message.t === 'pack' && pack.t === 'dev') {
        this.log.info(
          '[MESSAGE] Found device! Processing device registration...',
        );
        const deviceInfo = {
          ...pack,
          address: rinfo.address,
          port: rinfo.port,
          name: this.config.platform,
        };
        this.log.debug('[MESSAGE] Device info:', deviceInfo);
        this.registerDevice(deviceInfo);
      } else {
        this.log.debug(
          `[MESSAGE] Pack type '${pack.t}' is not 'dev', ignoring`,
        );
      }
    } catch (err) {
      this.log.error('[MESSAGE] handleMessage Error', err);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerDevice = (deviceInfo: any) => {
    this.log.info('[REGISTER] Attempting to register device:', deviceInfo);

    const deviceConfig = this.config;
    let accessory = this.device;

    this.log.debug(
      `[REGISTER] Current device state - accessory keys: ${
        Object.keys(accessory).length
      }, initializedDevice: ${this.initializedDevice}`,
    );

    if (Object.keys(accessory).length !== 0 && this.initializedDevice) {
      this.log.info(
        '[REGISTER] Device already registered and initialized, skipping',
      );
      return;
    }

    if (Object.keys(accessory).length === 0) {
      const deviceName = deviceInfo.name;
      this.log.info(
        `[REGISTER] Creating new accessory for device ${deviceInfo.mac} with name ${deviceName}`,
      );
      const uuid = this.api.hap.uuid.generate(deviceInfo.mac);
      this.log.debug(`[REGISTER] Generated UUID: ${uuid}`);

      accessory = new this.api.platformAccessory(deviceInfo.mac, uuid);
      this.log.debug('[REGISTER] Created platform accessory');

      this.device = accessory;
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory,
      ]);
      this.log.info(
        '[REGISTER] Successfully registered accessory with Homebridge',
      );
    } else {
      this.log.debug('[REGISTER] Using existing accessory from cache');
    }

    if (accessory) {
      this.log.debug('[REGISTER] Setting device context and initializing...');
      // mark devices as initialized.
      accessory.context.device = deviceInfo;
      this.initializedDevice = true;
      this.scanCount = this.config.scanCount;
      this.log.info(
        '[REGISTER] Device successfully registered and initialized!',
      );

      const daitsuDevice = new DaitsuATW(this, accessory, deviceConfig);
      this.log.debug('[REGISTER] DaitsuATW instance created');
      return daitsuDevice;
    } else {
      this.log.error('[REGISTER] Failed to create or retrieve accessory');
    }
  };
}
