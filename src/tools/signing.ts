import { ToolResult, ToolHandler, SigningIdentity, ProvisioningProfile } from '../types.js';
import { execCommand, execXcode } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';

/**
 * Tool definition interface
 */
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * list-certificates tool
 * List signing certificates available on the system
 */
const listCertificates: ToolDefinition = {
  name: 'list-certificates',
  description: 'List signing certificates available on the system. Can filter by certificate type (development, distribution, or all).',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['development', 'distribution', 'all'],
        description: 'Filter certificates by type: development, distribution, or all. Defaults to all.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const filterType = (args.type as string) || 'all';

      logger.info(`Listing certificates with filter: ${filterType}`);

      const result = await execCommand('security', ['find-identity', '-v', '-p', 'codesigning']);

      if (result.exitCode !== 0) {
        logger.warn('Failed to list certificates:', result.stderr);
        return {
          success: false,
          error: `Failed to list certificates: ${result.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const certificates: SigningIdentity[] = [];
      const lines = result.stdout.split('\n').filter(line => line.trim() && !line.includes('valid on'));

      for (const line of lines) {
        // Parse output like: "1) ABC123... "iPhone Developer: Name (ID)""
        const match = line.match(/(\d+)\)\s+([A-F0-9]+)\s+"(.+?)"/);
        if (match) {
          const [, , thumbprint, name] = match;

          // Determine certificate type from name
          let certType: 'development' | 'distribution' | 'developer_id_application' = 'development';
          if (name.includes('Distribution') || name.includes('App Store')) {
            certType = 'distribution';
          } else if (name.includes('Developer ID')) {
            certType = 'developer_id_application';
          }

          // Apply filter
          if (filterType !== 'all' && certType !== filterType) {
            continue;
          }

          certificates.push({
            id: thumbprint,
            name,
            commonName: name.split('(')[0].trim(),
            issuer: 'Apple',
            expiryDate: 'unknown',
            type: certType,
            thumbprint,
          });
        }
      }

      logger.info(`Found ${certificates.length} matching certificates`);

      return {
        success: true,
        data: {
          certificates,
          count: certificates.length,
          filter: filterType,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in list-certificates:', error);

      return {
        success: false,
        error: `Failed to list certificates: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * list-provisioning-profiles tool
 * List provisioning profiles available on the system
 */
const listProvisioningProfiles: ToolDefinition = {
  name: 'list-provisioning-profiles',
  description: 'List provisioning profiles available on the system. Can filter by bundle ID or team ID.',
  inputSchema: {
    type: 'object',
    properties: {
      bundleId: {
        type: 'string',
        description: 'Optional filter by bundle ID (e.g., com.example.app)',
      },
      teamId: {
        type: 'string',
        description: 'Optional filter by team ID',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const bundleIdFilter = args.bundleId as string | undefined;
      const teamIdFilter = args.teamId as string | undefined;

      logger.info('Listing provisioning profiles');

      const profilesPath = join(homedir(), 'Library/MobileDevice/Provisioning Profiles');

      if (!existsSync(profilesPath)) {
        logger.warn('Provisioning profiles directory does not exist');
        return {
          success: true,
          data: {
            profiles: [],
            count: 0,
            filters: { bundleId: bundleIdFilter, teamId: teamIdFilter },
          },
          executionTime: Date.now() - startTime,
        };
      }

      const files = readdirSync(profilesPath).filter(f => f.endsWith('.mobileprovision'));
      const profiles: ProvisioningProfile[] = [];

      for (const file of files) {
        try {
          const filePath = join(profilesPath, file);
          const decodeResult = await execCommand('security', ['cms', '-D', '-i', filePath]);

          if (decodeResult.exitCode !== 0) {
            logger.debug(`Failed to decode profile: ${file}`);
            continue;
          }

          // Parse plist-like output to extract key information
          const content = decodeResult.stdout;
          const identifierMatch = content.match(/<key>UUID<\/key>\s*<string>([^<]+)<\/string>/);
          const nameMatch = content.match(/<key>Name<\/key>\s*<string>([^<]+)<\/string>/);
          const bundleMatch = content.match(/<key>Identifier<\/key>\s*<string>([^<]+)<\/string>/);
          const teamMatch = content.match(/<key>TeamIdentifier<\/key>\s*<array>[\s\S]*?<string>([^<]+)<\/string>/);
          const expiryMatch = content.match(/<key>ExpirationDate<\/key>\s*<date>([^<]+)<\/date>/);

          if (identifierMatch && nameMatch) {
            const bundleId = bundleMatch ? bundleMatch[1] : '*';
            const teamId = teamMatch ? teamMatch[1] : 'unknown';

            // Apply filters
            if (bundleIdFilter && !bundleId.includes(bundleIdFilter)) {
              continue;
            }
            if (teamIdFilter && teamId !== teamIdFilter) {
              continue;
            }

            profiles.push({
              identifier: identifierMatch[1],
              name: nameMatch[1],
              bundleId,
              teamId,
              expiryDate: expiryMatch ? expiryMatch[1] : 'unknown',
              capabilities: [],
              path: filePath,
            });
          }
        } catch (err) {
          logger.debug(`Error processing profile ${file}:`, err);
        }
      }

      logger.info(`Found ${profiles.length} matching provisioning profiles`);

      return {
        success: true,
        data: {
          profiles,
          count: profiles.length,
          filters: { bundleId: bundleIdFilter, teamId: teamIdFilter },
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in list-provisioning-profiles:', error);

      return {
        success: false,
        error: `Failed to list provisioning profiles: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * import-certificate tool
 * Import a code signing certificate (.p12 or .cer)
 */
const importCertificate: ToolDefinition = {
  name: 'import-certificate',
  description: 'Import a code signing certificate (.p12 or .cer) into the system keychain.',
  inputSchema: {
    type: 'object',
    properties: {
      certificatePath: {
        type: 'string',
        description: 'Path to the certificate file (.p12 or .cer)',
      },
      password: {
        type: 'string',
        description: 'Optional password for .p12 certificate',
      },
      keychain: {
        type: 'string',
        description: 'Optional keychain name. Defaults to login keychain.',
      },
    },
    required: ['certificatePath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const certificatePath = args.certificatePath as string;
      const password = args.password as string | undefined;
      const keychain = args.keychain as string | undefined;

      if (!certificatePath) {
        return {
          success: false,
          error: 'certificatePath is required',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      if (!existsSync(certificatePath)) {
        return {
          success: false,
          error: `Certificate file not found: ${certificatePath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Importing certificate: ${certificatePath}`);

      const args_list = ['import', certificatePath];

      if (keychain) {
        args_list.push('-k', keychain);
      }

      if (password) {
        args_list.push('-P', password);
      }

      args_list.push('-T', '/usr/bin/codesign');

      const result = await execCommand('security', args_list);

      if (result.exitCode !== 0) {
        logger.error('Failed to import certificate:', result.stderr);
        return {
          success: false,
          error: `Failed to import certificate: ${result.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info('Certificate imported successfully');

      return {
        success: true,
        data: {
          imported: true,
          path: certificatePath,
          message: 'Certificate imported successfully',
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in import-certificate:', error);

      return {
        success: false,
        error: `Failed to import certificate: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * install-profile tool
 * Install a provisioning profile
 */
const installProfile: ToolDefinition = {
  name: 'install-profile',
  description: 'Install a provisioning profile (.mobileprovision) into the system.',
  inputSchema: {
    type: 'object',
    properties: {
      profilePath: {
        type: 'string',
        description: 'Path to the provisioning profile file (.mobileprovision)',
      },
    },
    required: ['profilePath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const profilePath = args.profilePath as string;

      if (!profilePath) {
        return {
          success: false,
          error: 'profilePath is required',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      if (!existsSync(profilePath)) {
        return {
          success: false,
          error: `Profile file not found: ${profilePath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Installing provisioning profile: ${profilePath}`);

      const destDir = join(homedir(), 'Library/MobileDevice/Provisioning Profiles');
      const filename = profilePath.split('/').pop() || 'profile.mobileprovision';
      const destPath = join(destDir, filename);

      // Create directory if it doesn't exist
      const { execSync } = await import('child_process');
      try {
        execSync(`mkdir -p "${destDir}"`);
      } catch (err) {
        logger.debug('Directory may already exist');
      }

      // Copy file
      const copyResult = await execCommand('cp', [profilePath, destPath]);

      if (copyResult.exitCode !== 0) {
        logger.error('Failed to copy profile:', copyResult.stderr);
        return {
          success: false,
          error: `Failed to copy profile: ${copyResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Extract UUID from profile
      const decodeResult = await execCommand('security', ['cms', '-D', '-i', destPath]);
      let uuid = 'unknown';
      if (decodeResult.exitCode === 0) {
        const uuidMatch = decodeResult.stdout.match(/<key>UUID<\/key>\s*<string>([^<]+)<\/string>/);
        if (uuidMatch) {
          uuid = uuidMatch[1];
        }
      }

      logger.info(`Profile installed successfully with UUID: ${uuid}`);

      return {
        success: true,
        data: {
          installed: true,
          sourcePath: profilePath,
          destinationPath: destPath,
          uuid,
          message: 'Profile installed successfully',
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in install-profile:', error);

      return {
        success: false,
        error: `Failed to install profile: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * sign-binary tool
 * Code sign a binary or framework
 */
const signBinary: ToolDefinition = {
  name: 'sign-binary',
  description: 'Code sign a binary or framework with a specific identity and optional entitlements.',
  inputSchema: {
    type: 'object',
    properties: {
      binaryPath: {
        type: 'string',
        description: 'Path to the binary, app, or framework to sign',
      },
      identity: {
        type: 'string',
        description: 'Certificate identity (name or thumbprint). If not provided, uses ad-hoc signing.',
      },
      entitlements: {
        type: 'string',
        description: 'Optional path to entitlements.plist file',
      },
      force: {
        type: 'boolean',
        description: 'Force re-signing even if already signed. Defaults to false.',
      },
    },
    required: ['binaryPath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const binaryPath = args.binaryPath as string;
      const identity = args.identity as string | undefined;
      const entitlements = args.entitlements as string | undefined;
      const force = (args.force as boolean) || false;

      if (!binaryPath) {
        return {
          success: false,
          error: 'binaryPath is required',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      if (!existsSync(binaryPath)) {
        return {
          success: false,
          error: `Binary path not found: ${binaryPath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Code signing binary: ${binaryPath}`);

      const signArgs: string[] = ['--sign'];
      signArgs.push(identity || '-');

      if (entitlements && existsSync(entitlements)) {
        signArgs.push('--entitlements', entitlements);
      }

      if (force) {
        signArgs.push('--force');
      }

      signArgs.push(binaryPath);

      const signResult = await execCommand('codesign', signArgs);

      if (signResult.exitCode !== 0) {
        logger.error('Failed to sign binary:', signResult.stderr);
        return {
          success: false,
          error: `Failed to sign binary: ${signResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Verify signature
      logger.info('Verifying signature');
      const verifyResult = await execCommand('codesign', [
        '--verify',
        '--deep',
        '--strict',
        '--verbose=2',
        binaryPath,
      ]);

      const verified = verifyResult.exitCode === 0;
      if (!verified) {
        logger.warn('Signature verification warning:', verifyResult.stderr);
      }

      logger.info(`Binary signed successfully${verified ? ' and verified' : ''}`);

      return {
        success: true,
        data: {
          signed: true,
          path: binaryPath,
          identity: identity || 'ad-hoc',
          verified,
          message: `Binary signed successfully${verified ? ' and verified' : ''}`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in sign-binary:', error);

      return {
        success: false,
        error: `Failed to sign binary: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * notarize-macos-app tool
 * Notarize a macOS app for distribution
 */
const notarizeMacosApp: ToolDefinition = {
  name: 'notarize-macos-app',
  description: 'Notarize a macOS app or DMG file for distribution. Returns notarization status and ticket ID.',
  inputSchema: {
    type: 'object',
    properties: {
      appPath: {
        type: 'string',
        description: 'Path to the .app bundle or .dmg file',
      },
      appleId: {
        type: 'string',
        description: 'Apple ID email address',
      },
      teamId: {
        type: 'string',
        description: 'App Store Connect Team ID',
      },
      password: {
        type: 'string',
        description: 'App-specific password (not regular Apple ID password)',
      },
    },
    required: ['appPath', 'appleId', 'teamId', 'password'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const appPath = args.appPath as string;
      const appleId = args.appleId as string;
      const teamId = args.teamId as string;
      const password = args.password as string;

      if (!appPath || !appleId || !teamId || !password) {
        return {
          success: false,
          error: 'appPath, appleId, teamId, and password are all required',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      if (!existsSync(appPath)) {
        return {
          success: false,
          error: `App path not found: ${appPath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Notarizing macOS app: ${appPath}`);

      const notarizeResult = await execXcode('notarytool', [
        'submit',
        appPath,
        '--apple-id',
        appleId,
        '--team-id',
        teamId,
        '--password',
        password,
        '--wait',
      ]);

      if (notarizeResult.exitCode !== 0) {
        logger.error('Notarization failed:', notarizeResult.stderr);
        return {
          success: false,
          error: `Notarization failed: ${notarizeResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Parse notarization output for ticket ID and status
      const ticketMatch = notarizeResult.stdout.match(/id: ([a-f0-9\-]+)/i);
      const statusMatch = notarizeResult.stdout.match(/status: (\w+)/i);

      const ticketId = ticketMatch ? ticketMatch[1] : 'unknown';
      const status = statusMatch ? statusMatch[1] : 'unknown';

      logger.info(`Notarization completed with status: ${status}`);

      return {
        success: status === 'Accepted' || status === 'accepted',
        data: {
          notarized: status === 'Accepted' || status === 'accepted',
          appPath,
          ticketId,
          status,
          message: `Notarization status: ${status}`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in notarize-macos-app:', error);

      return {
        success: false,
        error: `Failed to notarize app: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * verify-signature tool
 * Verify the code signature of a binary or app
 */
const verifySignature: ToolDefinition = {
  name: 'verify-signature',
  description: 'Verify the code signature of a binary, app bundle, or framework.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the binary, app bundle, or framework to verify',
      },
    },
    required: ['path'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const path = args.path as string;

      if (!path) {
        return {
          success: false,
          error: 'path is required',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      if (!existsSync(path)) {
        return {
          success: false,
          error: `Path not found: ${path}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Verifying signature: ${path}`);

      const result = await execCommand('codesign', [
        '--verify',
        '--deep',
        '--strict',
        '--verbose=2',
        path,
      ]);

      const verified = result.exitCode === 0;

      logger.info(`Signature verification ${verified ? 'passed' : 'failed'}`);

      return {
        success: verified,
        data: {
          verified,
          path,
          output: result.stdout || result.stderr,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in verify-signature:', error);

      return {
        success: false,
        error: `Failed to verify signature: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Export all signing tools
 */
export const signingTools: ToolDefinition[] = [
  listCertificates,
  listProvisioningProfiles,
  importCertificate,
  installProfile,
  signBinary,
  notarizeMacosApp,
  verifySignature,
];

export default signingTools;
