const commands = {
  power: {
    code: 'Pow',
    value: {
      off: 0,
      on: 1,
    },
  },
  mode: {
    code: 'Mod',
    value: {
      cool: 0,
      heat: 1,
      hotWater: 2,
      coolHotWater: 3,
      heatHotWater: 4,
    },
  },
  temperatureUnit: {
    code: 'TemUn',
    value: {
      celsius: 0,
      fahrenheit: 1,
    },
  },
  coolingWaterOutTempSet: {
    code: 'CoWatOutTemSet',
  },
  heatingWaterOutTempSet: {
    code: 'HeWatOutTemSet',
  },
  hepOutWaterTempHigh: {
    code: 'HepOutWatTemHi',
  },
  hepOutWaterTempLow: {
    code: 'HepOutWatTemLo',
  },
  waterBoxTempHigh: {
    code: 'WatBoxTemHi',
  },
  waterBoxTempLow: {
    code: 'WatBoxTemLo',
  },
  temperatureRecovery: {
    code: 'TemRec',
    value: {
      off: 0,
      on: 1,
    },
  },
  allError: {
    code: 'AllErr',
    value: {
      off: 0,
      on: 1,
    },
  },
  coldHotWater: {
    code: 'ColHtWter',
  },
  hotHotWater: {
    code: 'HetHtWter',
  },
  leftHome: {
    code: 'LefHom',
  },
  waterBoxElectricHeaterRunStatus: {
    code: 'WatBoxElcHeRunSta',
  },
  systemAntiFrostRunStatus: {
    code: 'SyAnFroRunSta',
  },
  electricHeater1RunStatus: {
    code: 'ElcHe1RunSta',
  },
  electricHeater2RunStatus: {
    code: 'ElcHe2RunSta',
  },
  hpAntiFreeze: {
    code: 'AnFrzzRunSta',
  },
  roomTempHigh: {
    code: 'RmoHomTemHi',
  },
  roomTempLow: {
    code: 'RmoHomTemLo',
  },
  waterBoxTempSet: {
    code: 'WatBoxTemSet',
  },
  host: {
    code: 'host',
  },
  name: {
    code: 'name',
  },
};

export default commands;
