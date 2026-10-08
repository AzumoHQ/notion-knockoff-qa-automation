// Environment Profile: maps a named role to its base URL, credentials env prefix and storageState file.
// credentialsEnvPrefix 'TEST_USER' resolves to TEST_USER_USERNAME / TEST_USER_PASSWORD.
import { BASE_URL } from '../utils/target.js';

export const PROFILES = {
  default: {
    name: 'default',
    baseUrl: BASE_URL,
    credentialsEnvPrefix: 'TEST_USER',
    storageStatePath: 'auth/default.storageState.json',
  },
};

/** Use as: test.use(useEnvironment('default')) */
export function useEnvironment(profileName) {
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`Unknown environment profile: "${profileName}". Add it to PROFILES in environment-profile.js`);
  return {
    baseURL: profile.baseUrl,
    storageState: profile.storageStatePath,
  };
}
