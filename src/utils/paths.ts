import { readdirSync, existsSync, statSync, mkdirSync, symlinkSync, unlinkSync, readlinkSync, lstatSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, basename, dirname } from 'path';
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
 * Default directory for new Xcode projects.
 * Projects should NEVER be created in /tmp — macOS clears it on reboot.
 */
export const DEFAULT_PROJECTS_DIR = join(homedir(), 'Developer');

/**
 * Directories considered volatile / unsafe for project storage.
 * If a project is created in one of these, we relocate to DEFAULT_PROJECTS_DIR.
 */
const VOLATILE_DIRS = ['/tmp', '/private/tmp', '/var/tmp'];

/**
 * Ensure the output path is safe (not volatile).
 * If the path is in /tmp or similar, redirect to ~/Developer/ and log a warning.
 *
 * @param requestedPath The path the caller wants to use
 * @param projectName The project name (used as fallback subdirectory)
 * @returns A safe, persistent path for the project
 */
export function ensureSafeProjectPath(requestedPath: string, projectName: string): { path: string; wasRedirected: boolean; warning?: string } {
  const resolved = resolve(requestedPath);

  for (const volatile of VOLATILE_DIRS) {
    if (resolved.startsWith(volatile + '/') || resolved === volatile) {
      const safePath = join(DEFAULT_PROJECTS_DIR, projectName);
      const warning = `Projektpfad "${resolved}" liegt in einem temporaeren Verzeichnis (wird beim Neustart geloescht). Projekt wird stattdessen unter "${safePath}" erstellt.`;
      logger.warn(warning);
      return { path: safePath, wasRedirected: true, warning };
    }
  }

  return { path: resolved, wasRedirected: false };
}

/**
 * Well-known directory where symlinks to built .app bundles are maintained.
 * Created during installation and updated after every successful build.
 */
export const APPS_OUTPUT_DIR = join(homedir(), '.xcode-mcp', 'Apps');

/**
 * Create or update a symlink in ~/.xcode-mcp/Apps/ pointing to the actual
 * .app bundle in DerivedData. This gives users a stable, well-known path
 * to find their built apps, regardless of how DerivedData paths change.
 *
 * @param appBundlePath Absolute path to the .app bundle (e.g. .../Build/Products/Debug-iphonesimulator/MyApp.app)
 * @param scheme Optional scheme name used as link name. Falls back to the .app bundle name.
 * @returns The symlink path, or null on failure
 */
export function updateBuildOutputLink(appBundlePath: string, scheme?: string): string | null {
  try {
    if (!appBundlePath || !existsSync(appBundlePath)) {
      logger.debug(`App bundle does not exist, skipping symlink: ${appBundlePath}`);
      return null;
    }

    // Ensure the Apps directory exists
    if (!existsSync(APPS_OUTPUT_DIR)) {
      mkdirSync(APPS_OUTPUT_DIR, { recursive: true });
      logger.info(`Created Apps output directory: ${APPS_OUTPUT_DIR}`);
    }

    // Determine symlink name: use scheme or derive from .app bundle name
    const appName = basename(appBundlePath); // e.g. "MyApp.app"
    const linkName = scheme || appName.replace(/\.app$/, '');
    const linkPath = join(APPS_OUTPUT_DIR, linkName);

    // Remove existing symlink (or file) at the target path
    try {
      const stat = lstatSync(linkPath);
      if (stat.isSymbolicLink() || stat.isFile() || stat.isDirectory()) {
        unlinkSync(linkPath);
      }
    } catch {
      // Does not exist yet — that's fine
    }

    // Create symlink
    symlinkSync(appBundlePath, linkPath);
    logger.info(`Updated app symlink: ${linkPath} -> ${appBundlePath}`);

    return linkPath;
  } catch (error) {
    logger.warn(`Failed to update build output link: ${error}`);
    return null;
  }
}

// ============================================================================
// Project Registry — persistent record of known Xcode projects
// ============================================================================

/**
 * Path to the project registry file.
 */
export const PROJECT_REGISTRY_PATH = join(homedir(), '.xcode-mcp', 'projects.json');

/**
 * A single entry in the project registry.
 */
export interface ProjectRegistryEntry {
  /** Absolute path to the project directory (containing .xcodeproj/.xcworkspace) */
  path: string;
  /** Path to the .xcodeproj or .xcworkspace file */
  projectFile: string;
  /** Bundle ID if known */
  bundleId?: string;
  /** Target platform */
  platform?: string;
  /** Build scheme used last */
  scheme?: string;
  /** ISO timestamp of last build/access */
  lastOpened: string;
}

/**
 * Load the full project registry from disk.
 * Returns a map of project name → entry.
 */
export function loadProjectRegistry(): Record<string, ProjectRegistryEntry> {
  try {
    if (existsSync(PROJECT_REGISTRY_PATH)) {
      const raw = readFileSync(PROJECT_REGISTRY_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (error) {
    logger.warn(`Failed to read project registry: ${error}`);
  }
  return {};
}

/**
 * Register or update a project in the registry.
 * Called automatically after create-project, build-project, and run-on-simulator.
 *
 * @param name Human-readable project name (e.g. "SorareTracker")
 * @param entry Project details to store/merge
 */
export function registerProject(name: string, entry: Partial<ProjectRegistryEntry> & { path: string; projectFile: string }): void {
  try {
    const registry = loadProjectRegistry();

    // Merge with existing entry (preserve fields not provided)
    const existing = registry[name] || {};
    registry[name] = {
      ...existing,
      ...entry,
      lastOpened: new Date().toISOString(),
    };

    // Ensure directory exists
    const dir = dirname(PROJECT_REGISTRY_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(PROJECT_REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf-8');
    logger.info(`Project registered: ${name} → ${entry.path}`);
  } catch (error) {
    logger.warn(`Failed to register project: ${error}`);
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
