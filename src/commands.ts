const commands = {
  allInWaterTempHigh: {
    code: "AllInWatTemHig",
  },
  allInWaterTempLow: {
    code: "AllInWatTemLow",
  },
  allOutWaterTempHigh: {
    code: "AllOutWatTemHig",
  },
  allOutWaterTempLow: {
    code: "AllOutWatTemLow",
  },
  hepOutWaterTempHigh: {
    code: "HepOutWatTemHig",
  },
  hepOutWaterTempLow: {
    code: "HepOutWatTemLow",
  },
  waaterBoxTempHigh: {
    code: "WatBoxTemHig",
  },
  waaterBoxTempLow: {
    code: "WatBoxTemLow",
  },
  roomTempHigh: {
    code: "RmoHomTemHi",
  },
  roomTempLow: {
    code: "RmoHomTemLo",
  },
  waterBoxElectricHeaterRunStatus: {
    code: "WatBoxElcHeRunSta",
  },
  systemAntiFrostRunStatus: {
    code: "SyAnFroRunSta",
  },
  electricHeater1RunStatus: {
    code: "ElcHe1RunSta",
  },
  electricHeater2RunStatus: {
    code: "ElcHe2RunSta",
  },
  antiFrostRunStatus: {
    code: "AnFrzzRunSta",
  },
  power: {
    code: "Pow",
    value: {
      off: 0,
      on: 1,
    },
  },
  mode: {
    code: "Mod",
    value: {
      auto: 0,
      cool: 1,
      dry: 2,
      fan: 3,
      heat: 4,
    },
  },
  coolingWaterOutTempSet: {
    code: "CoWatOutTemSet",
  },
  heatingWaterOutTempSet: {
    code: "HeWatOutTemSet",
  },
  waterBoxTempSet: {
    code: "WatBoxTemSet",
  },
  temperatureUnit: {
    code: "TemUn",
    value: {
      celsius: 0,
      fahrenheit: 1,
    },
  },
  temperatureRecovery: {
    code: "TemRec",
    value: {
      off: 0,
      on: 1,
    },
  },
  allError: {
    code: "AllErr",
    value: {
      off: 0,
      on: 1,
    },
  },
  host: {
    code: "host",
  },
  name: {
    code: "name",
  },
  coldHotWater: {
    code: "ColHtWter",
  },
  hotHotWater: {
    code: "HetHtWter",
  },
  leftHome: {
    code: "LefHom",
  },
  temperatureRecoveryB: {
    code: "TemRecB",
  },
  roomHomeTempExt: {
    code: "RomHomTemExt",
  },
  coolingHomeTempSet: {
    code: "CoHomTemSet",
  },
  heatingHomeTempSet: {
    code: "HeHomTemSet",
  },
};

export default commands;
