# Daitsu ATW Plugin

Plugin for Homebridge to control Daitsu ATW devices. This plugin is based on [homebridge-gree-air-conditioner](https://www.npmjs.com/package/homebridge-gree-air-conditioner), but focused on Daitsu ATW devices.

## Supports

- Daitsu ATW
- Gree & partners AC & ATW
- All AC devices controlled by EWPE Smart APP.

## Features

- Heater/Cooler info in a thermostat accessory
- Water box heater info in a thermostat accessory

## Requirements

- Node.js v22.12.0 or higher (v24 recommended with Homebridge 2.0)
- Homebridge v1.8.0 or v2.0.0 or higher
- Daitsu ATW device (tested on f1 modelType and version 5.0.0)

## Future features

- Flags for all status views (compressor, fan, etc.)
- Set methods to control the device
- Power & mode switches
- Temperature control
- Water box heater control

## Installation

From npm (recommended):

```
npm install -g homebridge-daitsu-atw@0.2.0
```

Or install from the Homebridge UI plugin search after version 0.2.0 is published.

## Configuration

```json
{
  "platforms": [
    {
      "platform": "DaitsuATW",
      "name": "Daitsu ATW",
      "scanAddress": "192.168.1.255",
      "scanCount": 10,
      "scanTimeout": 3000,
      "statusUpdateInterval": 60,
      "mac": "xx:xx:xx:xx:xx:xx"
    }
  ]
}
```

## Credits

[homebridge-gree-air-conditioner](https://github.com/kongkx/homebridge-gree-air-conditioner) by [kongkx](https://github.com/kongkx)

[gree-remote](https://github.com/tomikaa87/gree-remote/issues/43) by [tomikaa87](https://github.com/tomikaa87)
