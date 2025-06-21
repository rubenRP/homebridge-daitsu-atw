// Workaround for module resolution issue - using any types
import { API } from 'homebridge';

import { DaitsuPlatform } from './platform';
import { PLATFORM_NAME } from './settings';

/**
 * This method registers the platform with Homebridge
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default (api: API) => {
  api.registerPlatform(PLATFORM_NAME, DaitsuPlatform);
};
