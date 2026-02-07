import { readdirSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { execCommand, execXcode } from './exec.js';
import { logger } from './logger.js';

/**
 * Find .xcodeproj or .xcworkspace in the given directory or current directory
 * @param dir Optional directory to search in (defaults to current working directory)
 * @returns Path to the project/workspace or null if not found
 */
export async function findProjectPath(dir?: string): Promise<string | undefined> {
  const searchDir = dir ? resolve(dir) : process.cwd();

  logger.debug(`Searching for Xcode project in: ${searchDir}`);

  try {
    const entries = readdirSync(searchDir);

    // Prefer .xcworkspace over .xcodeproj
    const workspace = entries.find((entry) => entry.endsWith('.xcworkspace'));
    if (workspace) {
      const workspacePath = join(searchDir, workspace);
      logger.debug(`Found workspace: ${workspacePath}`);
      return workspacePath;
    }

    const project = entries.find((entry) => entry.endsWith('.xcodeproj'));
    if (project) {
      const projectPath = join(searchDir, project);
      logger.debug(`Found project: ${projectPath}`);
      return projectPath;
    }

    logger.debug(`No Xcode project found in ${searchDir}`);
    return undefined;
  } catch (error) {
    logger.error(`Error searching for project in ${searchDir}:`, error);
    return undefined;
  }
}

/**
 * Get the active Xcode path via xcode-select
 * @returns Path to active Xcode installation
 */
export async function getXcodePath(): Promise<string | null> {
  logger.debug('Fetching active Xcode path');

  const result = await execXcode('xcode-select', ['-p']);

  if (result.exitCode === 0) {
    const xcodePath = result.stdout.trim();
    logger.debug(`Active Xcode path: ${xcodePath}`);
    return xcodePath;
  }

  logger.error('Failed to get Xcode path', { stderr: result.stderr });
  return null;
}

/**
 * Get Xcode derived data path
 * @returns Path to DerivedData directory
 */
export async function getDerivedDataPath(): Promise<string | null> {
  const home = homedir();
  const derivedDataPath = join(home, 'Library/Developer/Xcode/DerivedData');

  if (existsSync(derivedDataPath)) {
    logger.debug(`Found DerivedData path: ${derivedDataPath}`);
    return derivedDataPath;
  }

  logger.warn(`DerivedData path does not exist: ${derivedDataPath}`);
  return null;
}

/**
 * Get simulator app data path for a specific simulator UDID
 * @param udid The simulator UDID
 * @returns Path to simulator data directory
 */
export function getSimulatorDataPath(udid: string): string {
  const home = homedir();
  const simulatorPath = join(
    home,
    'Library/Developer/CoreSimulator/Devices',
    udid,
    'data/Containers/Bundle/Application',
  );

  logger.debug(`Simulator data path for ${udid}: ${simulatorPath}`);
  return simulatorPath;
}

/**
 * Get provisioning profiles directory
 * @returns Path to provisioning profiles directory
 */
export async function getProvisioningProfilesPath(): Promise<string | null> {
  const home = homedir();
  const profilesPath = join(home, 'Library/MobileDevice/Provisioning Profiles');

  if (existsSync(profilesPath)) {
    logger.debug(`Found provisioning profiles path: ${profilesPath}`);
    return profilesPath;
  }

  logger.warn(`Provisioning profiles path does not exist: ${profilesPath}`);
  return null;
}

/**
 * Get list of simulator UDIDs that are available
 * @returns Array of available simulator UDIDs
 */
export async function getAvailableSimulators(): Promise<string[]> {
  logger.debug('Fetching available simulators');

  const result = await execCommand('xcrun', ['simctl', 'list', 'devices', '--json']);

  if (result.exitCode !== 0) {
    logger.error('Failed to get simulator list', { stderr: result.stderr });
    return [];
  }

  try {
    const data = JSON.parse(result.stdout);
    const udids: string[] = [];

    // Extract UDIDs from all device categories
    if (data.devices) {
      Object.values(data.devices).forEach((category: any) => {
        if (Array.isArray(category)) {
          category.forEach((device: any) => {
            if (device.udid && device.availability === '(available)') {
              udids.push(device.udid);
            }
          });
        }
      });
    }

    logger.debug(`Found ${udids.length} available simulators`);
    return udids;
  } catch (error) {
    logger.error('Error parsing simulator list:', error);
    return [];
  }
}

/**
 * Get Xcode build settings for a project
 * @param projectPath Path to .xcodeproj or .xcworkspace
 * @param scheme Scheme to query
 * @param configuration Configuration to query (Debug/Release)
 * @returns Build settings object
 */
export async function getXcodeBuildSettings(
  projectPath: string,
  scheme: string,
  configuration: string = 'Debug',
): Promise<Record<string, string> | null> {
  logger.debug(`Fetching build settings for ${projectPath} scheme ${scheme}`);

  const args = [
    '-' + (projectPath.endsWith('.xcworkspace') ? 'workspace' : 'project'),
    projectPath,
    '-scheme',
    scheme,
    '-configuration',
    configuration,
    '-showBuildSettings',
  ];

  const result = await execXcode('xcodebuild', args);

  if (result.exitCode !== 0) {
    logger.error('Failed to get build settings', { stderr: result.stderr });
    return null;
  }

  try {
    const settings: Record<string, string> = {};
    const lines = result.stdout.split('\n');

    lines.forEach((line) => {
      const match = line.match(/^\s*(\w+)\s*=\s*(.*)$/);
      if (match) {
        const [, key, value] = match;
        settings[key.trim()] = value.trim();
      }
    });

    return settings;
  } catch (error) {
    logger.error('Error parsing build settings:', error);
    return null;
  }
}
