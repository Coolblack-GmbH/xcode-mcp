import { ToolResult, ToolHandler } from '../types.js';
import { execCommand, execXcode, ExecResult, checkPlatformSDK, checkSimulatorRuntime } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';

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
 * Setup-xcode-select tool
 * Select/check Xcode installation and optionally switch to a specific version
 */
const setupXcodeSelect: ToolDefinition = {
  name: 'setup-xcode-select',
  description: 'Select/check Xcode installation. Displays current Xcode path and version. Can optionally switch to a specific Xcode installation.',
  inputSchema: {
    type: 'object',
    properties: {
      xcodeVersion: {
        type: 'string',
        description: 'Optional path to specific Xcode installation to switch to (e.g., /Applications/Xcode.app/Contents/Developer)',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const xcodeVersion = args.xcodeVersion as string | undefined;

      // Get current Xcode path
      const pathResult = await execXcode('xcode-select', ['-p']);
      const currentPath = pathResult.stdout.trim();

      // Get Xcode version
      const versionResult = await execXcode('xcodebuild', ['-version']);
      const versionOutput = versionResult.stdout.trim();

      let switchResult: ExecResult | null = null;
      let switchMessage = '';

      // If xcodeVersion provided, try to switch
      if (xcodeVersion) {
        logger.info(`Switching Xcode to: ${xcodeVersion}`);

        switchResult = await execXcode('xcode-select', ['--switch', xcodeVersion]);

        if (switchResult.exitCode === 0) {
          switchMessage = `Successfully switched Xcode to: ${xcodeVersion}`;
          logger.info(switchMessage);
        } else {
          logger.warn(`Failed to switch Xcode path: ${switchResult.stderr}`);
          return {
            success: false,
            error: `Failed to switch Xcode: ${switchResult.stderr}`,
            data: {
              currentPath,
              versionOutput,
              attemptedPath: xcodeVersion,
            },
            executionTime: Date.now() - startTime,
          };
        }
      }

      return {
        success: true,
        data: {
          currentPath,
          versionOutput,
          switched: !!switchResult && switchResult.exitCode === 0,
          switchMessage: switchMessage || 'No switch attempted',
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in setup-xcode-select:', error);

      return {
        success: false,
        error: `Failed to setup xcode-select: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Verify-environment tool
 * Verify all prerequisites are installed and check versions
 */
const verifyEnvironment: ToolDefinition = {
  name: 'verify-environment',
  description: 'Verify all prerequisites are installed including Xcode CLI tools, Homebrew, XcodeGen, CocoaPods, and Node.js. Returns status and version information.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const checks: Record<string, any> = {};
      const missing: string[] = [];

      // Check Xcode CLI tools
      logger.info('Checking Xcode CLI tools');
      const xcodeCliResult = await execXcode('xcode-select', ['--print-path']);
      if (xcodeCliResult.exitCode === 0) {
        checks.xcodeCliTools = {
          installed: true,
          path: xcodeCliResult.stdout.trim(),
        };
      } else {
        checks.xcodeCliTools = { installed: false };
        missing.push('Xcode CLI Tools');
      }

      // Check full Xcode installation
      logger.info('Checking Xcode installation');
      const xcodebuildResult = await execXcode('xcodebuild', ['-version']);
      if (xcodebuildResult.exitCode === 0) {
        checks.xcode = {
          installed: true,
          version: xcodebuildResult.stdout.split('\n')[0],
        };
      } else {
        checks.xcode = { installed: false };
        missing.push('Xcode (full installation)');
      }

      // Check installed platform SDKs (Xcode 26+ requires separate download)
      logger.info('Checking platform SDKs');
      const platformsToCheck = ['iOS', 'macOS', 'watchOS', 'tvOS', 'visionOS'];
      const installedPlatforms: string[] = [];
      const missingPlatforms: string[] = [];

      for (const p of platformsToCheck) {
        const sdkCheck = await checkPlatformSDK(p);
        if (sdkCheck.installed) {
          installedPlatforms.push(p);
        } else {
          missingPlatforms.push(p);
        }
      }

      checks.platformSDKs = {
        installed: installedPlatforms,
        missing: missingPlatforms,
        note: missingPlatforms.length > 0
          ? `Fehlende Plattformen mit 'xcodebuild -downloadPlatform <name>' installieren`
          : 'Alle Plattformen verfuegbar',
      };

      if (!installedPlatforms.includes('iOS') && !missingPlatforms.includes('iOS')) {
        // Could not determine - skip
      } else if (missingPlatforms.includes('iOS')) {
        missing.push('iOS Platform SDK (xcodebuild -downloadPlatform iOS)');
      }

      // Check Homebrew
      logger.info('Checking Homebrew');
      const brewResult = await execCommand('brew', ['--version']);
      if (brewResult.exitCode === 0) {
        const brewVersion = brewResult.stdout.split('\n')[0];
        checks.homebrew = {
          installed: true,
          version: brewVersion,
        };
      } else {
        checks.homebrew = { installed: false };
        missing.push('Homebrew');
      }

      // Check XcodeGen
      logger.info('Checking XcodeGen');
      const xcodegenResult = await execCommand('xcodegen', ['--version']);
      if (xcodegenResult.exitCode === 0) {
        checks.xcodegen = {
          installed: true,
          version: xcodegenResult.stdout.trim(),
        };
      } else {
        checks.xcodegen = { installed: false };
        missing.push('XcodeGen');
      }

      // Check CocoaPods
      logger.info('Checking CocoaPods');
      const podResult = await execCommand('pod', ['--version']);
      if (podResult.exitCode === 0) {
        checks.cocoapods = {
          installed: true,
          version: podResult.stdout.trim(),
        };
      } else {
        checks.cocoapods = { installed: false };
        missing.push('CocoaPods');
      }

      // Check Node.js
      logger.info('Checking Node.js');
      const nodeResult = await execCommand('node', ['--version']);
      if (nodeResult.exitCode === 0) {
        checks.nodejs = {
          installed: true,
          version: nodeResult.stdout.trim(),
        };
      } else {
        checks.nodejs = { installed: false };
        missing.push('Node.js');
      }

      const allInstalled = missing.length === 0;

      return {
        success: allInstalled,
        data: {
          allInstalled,
          checks,
          missing,
          missingCount: missing.length,
        },
        warnings: missing.length > 0 ? [`Missing: ${missing.join(', ')}`] : undefined,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in verify-environment:', error);

      return {
        success: false,
        error: `Failed to verify environment: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Install-xcodegen tool
 * Install or upgrade XcodeGen via Homebrew
 */
const installXcodegen: ToolDefinition = {
  name: 'install-xcodegen',
  description: 'Install or upgrade XcodeGen via Homebrew. Optionally specify a version to install.',
  inputSchema: {
    type: 'object',
    properties: {
      version: {
        type: 'string',
        description: 'Optional specific version to install (e.g., 2.35.0). If not provided, installs latest.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const version = args.version as string | undefined;

      // Check if xcodegen is already installed
      const checkResult = await execCommand('which', ['xcodegen']);
      const isInstalled = checkResult.exitCode === 0;

      logger.info(`XcodeGen already installed: ${isInstalled}`);

      let result: ExecResult;

      if (version) {
        // Install specific version
        logger.info(`Installing XcodeGen version ${version}`);
        result = await execCommand('brew', ['install', `xcodegen@${version}`]);
      } else {
        // Install or upgrade
        if (isInstalled) {
          logger.info('Upgrading XcodeGen');
          result = await execCommand('brew', ['upgrade', 'xcodegen']);
        } else {
          logger.info('Installing XcodeGen');
          result = await execCommand('brew', ['install', 'xcodegen']);
        }
      }

      if (result.exitCode !== 0) {
        logger.error('Failed to install XcodeGen:', result.stderr);
        return {
          success: false,
          error: `Failed to install XcodeGen: ${result.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Get installed version
      const versionResult = await execCommand('xcodegen', ['--version']);
      const installedVersion = versionResult.exitCode === 0 ? versionResult.stdout.trim() : 'unknown';

      logger.info(`XcodeGen installed successfully: ${installedVersion}`);

      return {
        success: true,
        data: {
          installed: true,
          version: installedVersion,
          upgraded: isInstalled,
          message: isInstalled ? 'XcodeGen upgraded successfully' : 'XcodeGen installed successfully',
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in install-xcodegen:', error);

      return {
        success: false,
        error: `Failed to install XcodeGen: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Check-cocoapods tool
 * Check CocoaPods installation and optionally upgrade
 */
const checkCocoapods: ToolDefinition = {
  name: 'check-cocoapods',
  description: 'Check CocoaPods installation status and version. Optionally upgrade to latest version.',
  inputSchema: {
    type: 'object',
    properties: {
      upgrade: {
        type: 'boolean',
        description: 'If true, upgrades CocoaPods to the latest version. Defaults to false.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const upgrade = (args.upgrade as boolean) || false;

      // Check current installation
      logger.info('Checking CocoaPods installation');
      const versionResult = await execCommand('pod', ['--version']);

      if (versionResult.exitCode !== 0) {
        logger.info('CocoaPods not installed, attempting to install');

        const installResult = await execCommand('gem', ['install', 'cocoapods']);

        if (installResult.exitCode !== 0) {
          return {
            success: false,
            error: `Failed to install CocoaPods: ${installResult.stderr}`,
            data: null,
            executionTime: Date.now() - startTime,
          };
        }
      }

      let currentVersion = versionResult.stdout.trim();
      let upgradeMessage = '';

      // Upgrade if requested
      if (upgrade) {
        logger.info('Upgrading CocoaPods');
        const upgradeResult = await execCommand('gem', ['install', 'cocoapods']);

        if (upgradeResult.exitCode === 0) {
          const newVersionResult = await execCommand('pod', ['--version']);
          if (newVersionResult.exitCode === 0) {
            const newVersion = newVersionResult.stdout.trim();
            upgradeMessage = `Upgraded from ${currentVersion} to ${newVersion}`;
            currentVersion = newVersion;
            logger.info(upgradeMessage);
          }
        } else {
          logger.warn('Failed to upgrade CocoaPods:', upgradeResult.stderr);
        }
      }

      return {
        success: true,
        data: {
          installed: true,
          version: currentVersion,
          upgraded: !!upgradeMessage,
          upgradeMessage: upgradeMessage || 'No upgrade performed',
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in check-cocoapods:', error);

      return {
        success: false,
        error: `Failed to check CocoaPods: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Download-platform tool
 * Download a platform SDK for Xcode (required in Xcode 26+)
 */
const downloadPlatform: ToolDefinition = {
  name: 'download-platform',
  description: 'Download a platform SDK for Xcode. In Xcode 26+, platform SDKs (iOS, watchOS, tvOS, visionOS) must be downloaded separately. This tool initiates the download which may take several minutes.',
  inputSchema: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        enum: ['iOS', 'macOS', 'watchOS', 'tvOS', 'visionOS'],
        description: 'Platform to download (e.g., iOS, watchOS).',
      },
    },
    required: ['platform'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const platform = args.platform as string;

      logger.info(`Checking if ${platform} SDK and simulator runtime are installed`);

      // Check SDK first
      const sdkCheck = await checkPlatformSDK(platform);

      // For platforms that have simulators, also check the runtime
      const simulatorPlatforms = ['iOS', 'watchOS', 'tvOS', 'visionOS'];
      if (sdkCheck.installed && simulatorPlatforms.includes(platform)) {
        const runtimeCheck = await checkSimulatorRuntime(platform);
        if (runtimeCheck.available) {
          return {
            success: true,
            data: {
              platform,
              alreadyInstalled: true,
              sdkPath: sdkCheck.sdkPath,
              runtimeVersion: runtimeCheck.runtimeVersion,
              message: `${platform} SDK und Simulator-Runtime sind bereits installiert.`,
            },
            executionTime: Date.now() - startTime,
          };
        }
        // SDK installed but runtime missing - continue to download
        logger.info(`${platform} SDK ist installiert, aber die Simulator-Runtime fehlt. Starte Download...`);
      } else if (sdkCheck.installed && platform === 'macOS') {
        return {
          success: true,
          data: {
            platform,
            alreadyInstalled: true,
            sdkPath: sdkCheck.sdkPath,
            message: `${platform} SDK ist bereits installiert.`,
          },
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Downloading ${platform} platform SDK...`);

      // Start the download - this can take a very long time (8+ GB for iOS)
      const downloadResult = await execXcode('xcodebuild', ['-downloadPlatform', platform], {
        timeout: 3600000, // 1 hour timeout
      });

      if (downloadResult.exitCode !== 0) {
        const stderr = downloadResult.stderr || '';
        return {
          success: false,
          error: `Download von ${platform} fehlgeschlagen: ${stderr.trim().slice(-500)}`,
          data: {
            platform,
            duration: downloadResult.duration,
            output: downloadResult.stdout.trim().slice(-300),
          },
          executionTime: Date.now() - startTime,
        };
      }

      // Verify installation
      const verifyCheck = await checkPlatformSDK(platform);

      logger.info(`${platform} SDK download completed`);

      return {
        success: true,
        data: {
          platform,
          installed: verifyCheck.installed,
          sdkPath: verifyCheck.sdkPath,
          duration: downloadResult.duration,
          message: `${platform} SDK erfolgreich heruntergeladen und installiert.`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in download-platform:', error);

      return {
        success: false,
        error: `Fehler beim Download der Plattform: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Export all setup tools
 */
export const tools: ToolDefinition[] = [
  setupXcodeSelect,
  verifyEnvironment,
  installXcodegen,
  checkCocoapods,
  downloadPlatform,
];

export default tools;
