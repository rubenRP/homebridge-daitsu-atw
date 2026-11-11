# Daitsu ATW Plugin

Plugin for Homebridge to control Daitsu ATW devices. This plugin is based on [homebridge-gree-air-conditioner](https://www.npmjs.com/package/homebridge-gree-air-conditioner), but focused on Daitsu ATW devices.

## Supports

- Daitsu ATW
- Gree & partners AC & ATW
- All AC devices controlled by EWPE Smart APP.

## Features

The device is exposed as one HomeKit accessory with these services:

| Service | HomeKit type | Shows | Controls |
| --- | --- | --- | --- |
| **Climate** | Thermostat | Water outlet temperature, heating/cooling/idle state, faults | Off / Heat / Cool, water outlet setpoint |
| **Hot Water** | Thermostat (Off / Heat) | Tank temperature, heating/idle state, faults | Hot water on/off, tank setpoint |
| **Outdoor** *(optional, experimental)* | Temperature sensor | Outdoor temperature (`OutEnvTem`) | - |

Notes:

- The Climate setpoint and current temperature are **water** temperatures (outlet flow), not room temperatures.
- Climate and hot water are independent: turning one off keeps the other running. The plugin maps
  the combination onto the device mode (`Mod`): heat, cool, hot water, heat + hot water or cool + hot water.
  The unit is only powered off when both are off.
- "Heating" vs "Idle" is estimated by comparing the current temperature with the setpoint, and the
  backup electric heaters' run status.
- `StatusFault` is raised on both thermostats when the device reports an error (`AllErr`).
- When the device stops answering for 3 polls it shows as "No Response" and the plugin re-binds automatically.

## Requirements

- Node.js v22.12.0 or higher (v24 recommended with Homebridge 2.0)
- Homebridge v1.8.0 or v2.0.0 or higher
- Daitsu ATW device (tested on f1 modelType and version 5.0.0)

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
      "mac": "xx:xx:xx:xx:xx:xx",
      "climateName": "Climate",
      "enableHotWater": true,
      "hotWaterName": "Hot Water",
      "outdoorTemperatureSensor": false,
      "heatingMin": 20,
      "heatingMax": 60,
      "coolingMin": 7,
      "coolingMax": 25,
      "hotWaterMin": 30,
      "hotWaterMax": 60,
      "diagnostics": false,
      "extraStatusCols": []
    }
  ]
}
```

| Option | Default | Description |
| --- | --- | --- |
| `scanAddress` | `192.168.1.255` | Broadcast address of your LAN, used to discover the device. |
| `mac` | - | Only register the device with this MAC (any separator format). |
| `statusUpdateInterval` | `60` | Seconds between status polls. |
| `climateName` / `hotWaterName` | `Climate` / `Hot Water` | Names shown in HomeKit (renaming in the Home app is kept). |
| `enableHotWater` | `true` | Expose the hot water thermostat. |
| `outdoorTemperatureSensor` | `false` | Expose `OutEnvTem` as a temperature sensor. Check the raw value with `diagnostics` first. |
| `heatingMin` / `heatingMax` | `20` / `60` | Heating water setpoint range (°C). |
| `coolingMin` / `coolingMax` | `7` / `25` | Cooling water setpoint range (°C). |
| `hotWaterMin` / `hotWaterMax` | `30` / `60` | Hot water tank setpoint range (°C). |
| `diagnostics` | `false` | Log every changed status field at info level. |
| `extraStatusCols` | `[]` | Extra status fields to request and log. |

## Discovering more parameters

The protocol parameters were obtained by decrypting the traffic of the official app, so some fields
may be missing or unverified. To check what your unit reports, enable `diagnostics` and add candidate
fields to `extraStatusCols`, for example:

```json
"diagnostics": true,
"extraStatusCols": ["RmoHomTemHi", "RmoHomTemLo", "ColHtWter", "HetHtWter", "LefHom"]
```

Every change is then logged as `Status changed: {...}`. Please open an issue with the values you find.

## Credits

[homebridge-gree-air-conditioner](https://github.com/kongkx/homebridge-gree-air-conditioner) by [kongkx](https://github.com/kongkx)

[gree-remote](https://github.com/tomikaa87/gree-remote/issues/43) by [tomikaa87](https://github.com/tomikaa87)
