import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { homedir, platform } from 'os';
import { execXcode, execSimctl, execCommand, execShell } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import type {
  XcodeProject,
  SDKInfo,
  SigningIdentity,
  ProvisioningProfile,
  Simulator,
} from '../types.js';

/**
 * Get current project info
 */
export async function getProjectInfo(projectPath?: string): Promise<XcodeProject | null> {
  try {
    const cwd = projectPath || process.cwd();

    const result = await execXcode('xcodebuild', ['-list', '-json'], { cwd });

    if (result.exitCode !== 0) {
      logger.error('Failed to get project info', { stderr: result.stderr });
      return null;
    }

    const projectData = JSON.parse(result.stdout);

    // Extract project information
    const projectName = projectData.project?.name || 'Unknown';
    const schemes = projectData.project?.schemes || [];
    const targets = projectData.project?.targets || [];

    // Build targets array
    const buildTargets = targets.map((targetName: string) => ({
      name: targetName,
      type: 'application' as const,
      platform: 'iOS',
      bundleId: '',
      productName: targetName,
    }));

    return {
      name: projectName,
      path: cwd,
      version: '1.0',
      bundleId: 'com.example.app',
      platform: 'iOS',
      targets: buildTargets,
      schemes,
      minDeploymentTarget: '12.0',
    };
  } catch (error) {
    logger.error('Error getting project info', { error });
    return null;
  }
}

/**
 * Get installed SDKs
 */
export async function getInstalledSDKs(): Promise<SDKInfo[]> {
  try {
    const result = await execXcode('xcodebuild', ['-showsdks']);

    if (result.exitCode !== 0) {
      logger.error('Failed to get installed SDKs', { stderr: result.stderr });
      return [];
    }

    const sdks: SDKInfo[] = [];
    const lines = result.stdout.split('\n');

    for (const line of lines) {
      const match = line.match(/^[a-z]+\s+(.*?)\s+\((.+?)\)\s+-\s+(.*)$/);
      if (match) {
        const [, version, platform, path] = match;
        sdks.push({
          platform: platform.trim(),
          version: version.trim(),
          path: path.trim(),
          buildVersion: '',
        });
      }
    }

    return sdks;
  } catch (error) {
    logger.error('Error getting installed SDKs', { error });
    return [];
  }
}

/**
 * Get signing certificates
 */
export async function getSigningCertificates(): Promise<SigningIdentity[]> {
  try {
    const result = await execCommand('security', [
      'find-identity',
      '-v',
      '-p',
      'codesigning',
    ]);

    if (result.exitCode !== 0) {
      logger.warn('Failed to get signing certificates', { stderr: result.stderr });
      return [];
    }

    const certificates: SigningIdentity[] = [];
    const lines = result.stdout.split('\n');

    for (const line of lines) {
      const match = line.match(/(\d+)\)\s+([A-F0-9]+)\s+"(.+?)"\s+\((.+?)\)/);
      if (match) {
        const [, , id, name, issuer] = match;
        certificates.push({
          id: id.trim(),
          name: name.trim(),
          commonName: name.trim(),
          issuer: issuer.trim(),
          expiryDate: new Date().toISOString(),
          type: issuer.includes('Apple Development') ? 'development' : 'distribution',
          thumbprint: id.trim(),
        });
      }
    }

    return certificates;
  } catch (error) {
    logger.error('Error getting signing certificates', { error });
    return [];
  }
}

/**
 * Get provisioning profiles
 */
export async function getProvisioningProfiles(): Promise<ProvisioningProfile[]> {
  try {
    const profilesDir = join(homedir(), 'Library', 'MobileDevice', 'Provisioning Profiles');
    const profiles: ProvisioningProfile[] = [];

    try {
      const files = readdirSync(profilesDir);

      for (const file of files) {
        if (extname(file) !== '.mobileprovision') continue;

        const profilePath = join(profilesDir, file);

        // Extract embedded.mobileprovision content using security command
        const result = await execCommand('security', ['cms', '-D', '-i', profilePath]);

        if (result.exitCode === 0) {
          try {
            // Parse the plist output
            const plistContent = result.stdout;

            // Extract key information using regex or plist parser
            const nameMatch = plistContent.match(/<key>Name<\/key>\s*<string>(.+?)<\/string>/);
            const bundleIdMatch = plistContent.match(/<key>Identifiers<\/key>\s*<array>.*?<string>(.+?)<\/string>/s);
            const teamIdMatch = plistContent.match(/<key>TeamIdentifier<\/key>\s*<array>.*?<string>(.+?)<\/string>/s);

            if (nameMatch) {
              profiles.push({
                identifier: file.replace('.mobileprovision', ''),
                name: nameMatch[1],
                bundleId: bundleIdMatch ? bundleIdMatch[1] : '*',
                teamId: teamIdMatch ? teamIdMatch[1] : '',
                expiryDate: new Date().toISOString(),
                capabilities: [],
                path: profilePath,
              });
            }
          } catch (parseError) {
            logger.debug('Failed to parse provisioning profile', { file, error: parseError });
          }
        }
      }
    } catch (dirError) {
      logger.debug('Provisioning profiles directory not found or inaccessible');
    }

    return profiles;
  } catch (error) {
    logger.error('Error getting provisioning profiles', { error });
    return [];
  }
}

/**
 * Get simulators list
 */
export async function getSimulatorsList(): Promise<Simulator[]> {
  try {
    const result = await execSimctl(['list', 'devices', '-j']);

    if (result.exitCode !== 0) {
      logger.error('Failed to get simulators list', { stderr: result.stderr });
      return [];
    }

    const simData = JSON.parse(result.stdout);
    const simulators: Simulator[] = [];

    // Process devices by runtime/OS
    for (const [runtime, devices] of Object.entries(simData.devices || {})) {
      if (!Array.isArray(devices)) continue;

      for (const device of devices) {
        const d = device as any;
        simulators.push({
          udid: d.udid || '',
          name: d.name || 'Unknown',
          deviceType: d.deviceType || 'Unknown',
          osVersion: runtime,
          state: (d.state || 'Shutdown') as 'Booted' | 'Shutdown' | 'Unavailable',
          isAvailable: d.isAvailable !== false && d.isAvailable !== 'false',
        });
      }
    }

    return simulators;
  } catch (error) {
    logger.error('Error getting simulators list', { error });
    return [];
  }
}

/**
 * Get build log by path
 */
export async function getBuildLog(logPath: string): Promise<string> {
  try {
    // Verify the path exists and is readable
    const stat = statSync(logPath);

    if (!stat.isFile()) {
      logger.error('Build log path is not a file', { logPath });
      return '';
    }

    // Read the log file
    const content = readFileSync(logPath, 'utf-8');
    return content;
  } catch (error) {
    logger.error('Error reading build log', { logPath, error });
    return '';
  }
}
