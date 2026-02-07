import { ToolResult, ToolHandler, BuildResult, ArchiveInfo, Configuration } from '../types.js';
import { execXcode, execCommand, execSimctl, ExecResult, checkXcodebuild, checkPlatformSDK, checkSimulatorRuntime } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { parseXcodeBuildErrors, formatErrors } from '../utils/errors.js';
import { findProjectPath, getDerivedDataPath, getXcodeBuildSettings } from '../utils/paths.js';
import { existsSync, statSync, rmSync } from 'fs';
import { join } from 'path';

/**
 * Detect if a build failure is caused by a missing platform SDK.
 * Actually verifies the SDK status before claiming it's missing.
 * Returns a helpful error message if SDK is truly missing, otherwise null.
 */
async function detectMissingPlatform(output: string): Promise<string | null> {
  // Only trigger on patterns that strongly indicate a missing SDK
  // NOT "no matching destination" or "Found no destinations" which can be scheme/config issues
  const sdkMissingPatterns = [
    /SDK "([^"]+)" cannot be located/i,
    /unable to find sdk '([^']+)'/i,
    /missing.*(?:ios|watchos|tvos|visionos|macos).*sdk/i,
    /(?:iphoneos|iphonesimulator|watchos|watchsimulator|appletvos|appletvsimulator|xros|xrsimulator)\d+\.\d+.*(?:cannot be located|not found|missing)/i,
  ];

  let possiblyMissing = false;

  for (const pattern of sdkMissingPatterns) {
    if (pattern.test(output)) {
      possiblyMissing = true;
      break;
    }
  }

  if (!possiblyMissing) return null;

  // Determine which platform and actually verify
  const lower = output.toLowerCase();
  let platform = 'iOS';
  if (lower.includes('watchos') || lower.includes('watchsimulator')) platform = 'watchOS';
  else if (lower.includes('tvos') || lower.includes('appletvsimulator')) platform = 'tvOS';
  else if (lower.includes('xros') || lower.includes('xrsimulator')) platform = 'visionOS';
  else if (lower.includes('macos') || lower.includes('macosx')) platform = 'macOS';

  // Actually check if the SDK is installed before reporting missing
  const sdkCheck = await checkPlatformSDK(platform);
  if (sdkCheck.installed) {
    // SDK is installed - this error is NOT about a missing platform
    return null;
  }

  return `${platform}-Plattform SDK ist nicht installiert. In Xcode 26+ muessen Plattformen separat heruntergeladen werden.\n` +
    `Bitte ausfuehren: xcodebuild -downloadPlatform ${platform}\n` +
    `Oder das MCP-Tool 'download-platform' mit platform="${platform}" verwenden.`;
}

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
 * Build-project tool
 * Build project for specified platform and configuration
 */
const buildProject: ToolDefinition = {
  name: 'build-project',
  description: 'Build project for specified platform and configuration. Uses xcodebuild to compile the project/workspace and returns build result with warnings and errors.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Optional path to .xcodeproj or .xcworkspace. If not provided, searches current directory.',
      },
      scheme: {
        type: 'string',
        description: 'Build scheme to use. Required if project has multiple schemes.',
      },
      configuration: {
        type: 'string',
        enum: ['Debug', 'Release'],
        description: 'Build configuration (Debug or Release). Defaults to Debug.',
      },
      platform: {
        type: 'string',
        description: 'Target platform SDK (e.g., iphoneos, iphonesimulator, macosx). If not provided, uses default.',
      },
      destination: {
        type: 'string',
        description: 'Build destination specifier (e.g., "generic/platform=iOS"). Optional.',
      },
      verbose: {
        type: 'boolean',
        description: 'Enable verbose output. Defaults to false.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      // Check if xcodebuild is functional
      const xcodeError = await checkXcodebuild();
      if (xcodeError) {
        return { success: false, error: xcodeError, data: null, executionTime: Date.now() - startTime };
      }

      let projectPath = args.projectPath as string | undefined;
      const scheme = args.scheme as string | undefined;
      const configuration = (args.configuration as Configuration) || 'Debug';
      const platform = args.platform as string | undefined;
      const destination = args.destination as string | undefined;
      const verbose = (args.verbose as boolean) || false;

      // Find project if not provided
      if (!projectPath) {
        projectPath = await findProjectPath();
        if (!projectPath) {
          return {
            success: false,
            error: 'Could not find .xcodeproj or .xcworkspace in current directory',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }
      }

      logger.info(`Building project: ${projectPath}`);

      const isWorkspace = projectPath.endsWith('.xcworkspace');
      const buildArgs: string[] = [
        isWorkspace ? '-workspace' : '-project',
        projectPath,
        'build',
      ];

      if (scheme) {
        buildArgs.push('-scheme', scheme);
      }

      buildArgs.push('-configuration', configuration);

      if (platform) {
        buildArgs.push('-sdk', platform);
      }

      if (destination) {
        buildArgs.push('-destination', destination);
      }

      if (verbose) {
        buildArgs.push('-verbose');
      }

      const buildResult = await execXcode('xcodebuild', buildArgs);

      // Parse errors from output
      const combinedOutput = buildResult.stderr + '\n' + buildResult.stdout;
      const errors = parseXcodeBuildErrors(combinedOutput);

      // Handle build failure with clear error message
      if (buildResult.exitCode !== 0) {
        // Check for missing platform SDK first (Xcode 26+)
        const platformError = await detectMissingPlatform(combinedOutput);
        if (platformError) {
          return {
            success: false,
            error: platformError,
            data: { projectPath, scheme: scheme || 'default', configuration, platform: platform || 'default' },
            executionTime: Date.now() - startTime,
          };
        }

        const errorDetail = formatErrors(errors);
        const errorMessage = errorDetail
          ? `Build failed: ${errorDetail}`
          : `Build failed:\n${combinedOutput.trim().slice(-800)}`;
        return {
          success: false,
          error: errorMessage,
          data: {
            projectPath,
            scheme: scheme || 'default',
            configuration,
            platform: platform || 'default',
            duration: buildResult.duration,
          },
          executionTime: Date.now() - startTime,
        };
      }

      // Extract output path from build output
      let outputPath = '';
      const outputMatch = buildResult.stdout.match(/Build directory:\s*(.+)/);
      if (outputMatch) {
        outputPath = outputMatch[1].trim();
      }

      const buildIssues = errors.map((error) => ({
        severity: error.type === 'GENERIC' ? 'note' : 'error',
        message: error.message,
        file: error.file,
        line: error.line,
        column: error.column,
      }));

      logger.info('Build succeeded');

      return {
        success: true,
        data: {
          projectPath,
          scheme: scheme || 'default',
          configuration,
          platform: platform || 'default',
          outputPath,
          warnings: buildIssues.filter((i) => i.severity === 'warning'),
          errors: buildIssues.filter((i) => i.severity === 'error'),
          duration: buildResult.duration,
          buildOutput: verbose ? buildResult.stdout : undefined,
        },
        warnings: errors.length > 0 ? [formatErrors(errors)] : undefined,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in build-project:', error);

      return {
        success: false,
        error: `Failed to build project: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Build-universal-binary tool
 * Create universal binary using lipo
 */
const buildUniversalBinary: ToolDefinition = {
  name: 'build-universal-binary',
  description: 'Create universal binary combining arm64 and x86_64 architectures using lipo.',
  inputSchema: {
    type: 'object',
    properties: {
      arm64Path: {
        type: 'string',
        description: 'Path to ARM64 binary.',
      },
      x86_64Path: {
        type: 'string',
        description: 'Path to x86_64 binary.',
      },
      outputPath: {
        type: 'string',
        description: 'Output path for the universal binary.',
      },
    },
    required: ['arm64Path', 'x86_64Path', 'outputPath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const arm64Path = args.arm64Path as string;
      const x86_64Path = args.x86_64Path as string;
      const outputPath = args.outputPath as string;

      // Verify input files exist
      if (!existsSync(arm64Path)) {
        return {
          success: false,
          error: `ARM64 binary not found: ${arm64Path}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      if (!existsSync(x86_64Path)) {
        return {
          success: false,
          error: `x86_64 binary not found: ${x86_64Path}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Creating universal binary from ${arm64Path} and ${x86_64Path}`);

      // Create universal binary
      const lipoResult = await execCommand('lipo', ['-create', '-output', outputPath, arm64Path, x86_64Path]);

      if (lipoResult.exitCode !== 0) {
        return {
          success: false,
          error: `Failed to create universal binary: ${lipoResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Verify the output
      const infoResult = await execCommand('lipo', ['-info', outputPath]);

      if (infoResult.exitCode !== 0) {
        return {
          success: false,
          error: `Failed to verify universal binary: ${infoResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const stat = statSync(outputPath);

      logger.info(`Universal binary created successfully: ${outputPath}`);

      return {
        success: true,
        data: {
          outputPath,
          size: stat.size,
          architectures: infoResult.stdout.trim(),
          arm64Path,
          x86_64Path,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in build-universal-binary:', error);

      return {
        success: false,
        error: `Failed to create universal binary: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Clean-build tool
 * Clean build artifacts and optionally DerivedData
 */
const cleanBuild: ToolDefinition = {
  name: 'clean-build',
  description: 'Clean build artifacts using xcodebuild clean. Optionally removes DerivedData directory.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Optional path to .xcodeproj or .xcworkspace.',
      },
      scheme: {
        type: 'string',
        description: 'Build scheme to clean. Optional.',
      },
      allTargets: {
        type: 'boolean',
        description: 'If true, cleans all targets. If false, removes DerivedData. Defaults to false.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      let projectPath = args.projectPath as string | undefined;
      const scheme = args.scheme as string | undefined;
      const allTargets = (args.allTargets as boolean) || false;

      // Find project if not provided
      if (!projectPath) {
        projectPath = await findProjectPath();
        if (!projectPath) {
          return {
            success: false,
            error: 'Could not find .xcodeproj or .xcworkspace in current directory',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }
      }

      logger.info(`Cleaning build for project: ${projectPath}`);

      const isWorkspace = projectPath.endsWith('.xcworkspace');
      const cleanArgs: string[] = [
        isWorkspace ? '-workspace' : '-project',
        projectPath,
        'clean',
      ];

      if (scheme) {
        cleanArgs.push('-scheme', scheme);
      }

      const cleanResult = await execXcode('xcodebuild', cleanArgs);

      if (cleanResult.exitCode !== 0) {
        logger.warn(`Build clean returned non-zero exit code: ${cleanResult.exitCode}`);
      }

      let derivedDataRemoved = false;
      let derivedDataPath: string | null = null;

      // Remove DerivedData if not cleaning all targets
      if (!allTargets) {
        logger.info('Removing DerivedData directory');
        derivedDataPath = await getDerivedDataPath();

        if (derivedDataPath && existsSync(derivedDataPath)) {
          try {
            rmSync(derivedDataPath, { recursive: true, force: true });
            derivedDataRemoved = true;
            logger.info('DerivedData removed successfully');
          } catch (error) {
            logger.warn('Failed to remove DerivedData:', error);
          }
        }
      }

      logger.info('Build cleaned successfully');

      return {
        success: true,
        data: {
          projectPath,
          scheme: scheme || 'all',
          cleanedAllTargets: allTargets,
          derivedDataRemoved,
          derivedDataPath,
          output: cleanResult.stdout,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in clean-build:', error);

      return {
        success: false,
        error: `Failed to clean build: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Run-on-simulator tool
 * Build and run app on iOS simulator
 */
const runOnSimulator: ToolDefinition = {
  name: 'run-on-simulator',
  description: 'Build project and run on specified simulator. If no simulator specified, uses default available simulator.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Optional path to .xcodeproj or .xcworkspace.',
      },
      scheme: {
        type: 'string',
        description: 'Build scheme to run.',
      },
      simulator: {
        type: 'string',
        description: 'Simulator name or UDID. Defaults to first available iOS simulator.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      // Check if xcodebuild is functional
      const xcodeError = await checkXcodebuild();
      if (xcodeError) {
        return { success: false, error: xcodeError, data: null, executionTime: Date.now() - startTime };
      }

      // Check if iOS simulator runtime is available (SDK alone is not enough)
      const runtimeCheck = await checkSimulatorRuntime('iOS');
      if (!runtimeCheck.available) {
        // Check if a download might be in progress
        let downloadStatus = 'unknown';
        try {
          const diskResult = await execCommand('xcrun', ['simctl', 'runtime', 'list'], { timeout: 10000 });
          if (diskResult.exitCode === 0) {
            const output = diskResult.stdout;
            if (output.includes('Total Disk Images: 0')) {
              downloadStatus = 'not_started';
            } else if (output.includes('Downloading') || output.includes('%')) {
              downloadStatus = 'downloading';
            } else if (output.includes('Ready')) {
              downloadStatus = 'ready';
            }
          }
        } catch { /* ignore */ }

        const downloadHint = downloadStatus === 'downloading'
          ? 'Ein Download laeuft bereits. Verwende "check-download-status" um den Fortschritt zu pruefen. Warte bis der Download abgeschlossen ist, dann versuche es erneut.'
          : downloadStatus === 'not_started'
            ? 'Starte den Download mit: download-platform (platform="iOS"). Der Download ist ca. 7-8 GB gross und dauert je nach Internetverbindung 10-30 Minuten. Verwende "check-download-status" um den Fortschritt zu ueberwachen.'
            : 'Verwende "download-platform" mit platform="iOS" um die Runtime herunterzuladen, oder "check-download-status" um den aktuellen Status zu pruefen.';

        return {
          success: false,
          error: `iOS Simulator-Runtime ist nicht installiert. Ohne Runtime kann kein Simulator gestartet werden.\n\n${downloadHint}`,
          data: {
            sdkVersion: runtimeCheck.sdkVersion,
            installedRuntimes: runtimeCheck.runtimeVersion,
            downloadStatus,
            actions: [
              'download-platform (platform="iOS") -- Runtime herunterladen (~7-8 GB)',
              'check-download-status -- Fortschritt pruefen',
            ],
          },
          executionTime: Date.now() - startTime,
        };
      }

      let projectPath = args.projectPath as string | undefined;
      const scheme = args.scheme as string | undefined;
      let simulator = args.simulator as string | undefined;

      // Find project if not provided
      if (!projectPath) {
        projectPath = await findProjectPath();
        if (!projectPath) {
          return {
            success: false,
            error: 'Could not find .xcodeproj or .xcworkspace in current directory',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }
      }

      // Step 1: Find a suitable simulator
      logger.info('Finding suitable simulator...');
      let simulatorUDID = '';
      let simulatorName = simulator || '';

      const listResult = await execSimctl(['list', 'devices', 'available', '-j']);
      if (listResult.exitCode === 0) {
        try {
          const devicesData = JSON.parse(listResult.stdout);
          const devices = devicesData.devices || {};

          // Find a booted simulator first, or the best available one
          let bestDevice: { udid: string; name: string; state: string; runtime: string } | null = null;

          for (const [runtime, deviceList] of Object.entries(devices)) {
            if (!runtime.includes('iOS') && !runtime.includes('SimRuntime.iOS')) continue;
            const devs = deviceList as Array<{ udid: string; name: string; state: string; isAvailable: boolean }>;
            for (const dev of devs) {
              if (!dev.isAvailable) continue;

              // If user specified a name, match it
              if (simulator && (dev.name === simulator || dev.udid === simulator)) {
                bestDevice = { udid: dev.udid, name: dev.name, state: dev.state, runtime };
                break;
              }

              // Prefer already booted simulators
              if (!simulator) {
                if (dev.state === 'Booted') {
                  bestDevice = { udid: dev.udid, name: dev.name, state: dev.state, runtime };
                  break;
                }
                // Pick first iPhone simulator as fallback
                if (!bestDevice && dev.name.includes('iPhone')) {
                  bestDevice = { udid: dev.udid, name: dev.name, state: dev.state, runtime };
                }
              }
            }
            if (bestDevice && bestDevice.state === 'Booted') break;
          }

          if (bestDevice) {
            simulatorUDID = bestDevice.udid;
            simulatorName = bestDevice.name;
            logger.info(`Using simulator: ${simulatorName} (${simulatorUDID}) [${bestDevice.state}]`);

            // Boot simulator if not already running
            if (bestDevice.state !== 'Booted') {
              logger.info(`Booting simulator: ${simulatorName}...`);
              await execSimctl(['boot', simulatorUDID]);
              // Wait a moment for boot
              await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // Open Simulator.app to make it visible
            await execCommand('open', ['-a', 'Simulator']);
          }
        } catch (parseErr) {
          logger.warn('Could not parse simulator list, continuing with generic destination');
        }
      }

      if (!simulatorUDID) {
        return {
          success: false,
          error: 'Kein verfuegbarer iOS Simulator gefunden. Bitte erst einen Simulator erstellen oder die iOS-Plattform herunterladen: xcodebuild -downloadPlatform iOS',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Step 2: Build for the specific simulator
      logger.info(`Building for simulator: ${simulatorName}...`);

      const isWorkspace = projectPath.endsWith('.xcworkspace');
      const buildArgs: string[] = [
        isWorkspace ? '-workspace' : '-project',
        projectPath,
        'build',
      ];

      if (scheme) {
        buildArgs.push('-scheme', scheme);
      }

      buildArgs.push('-configuration', 'Debug');
      buildArgs.push('-destination', `id=${simulatorUDID}`);

      const buildResult = await execXcode('xcodebuild', buildArgs);

      if (buildResult.exitCode !== 0) {
        const combinedOutput = buildResult.stderr + '\n' + buildResult.stdout;

        // Check for missing platform SDK (Xcode 26+)
        const platformError = await detectMissingPlatform(combinedOutput);
        if (platformError) {
          return { success: false, error: platformError, data: null, executionTime: Date.now() - startTime };
        }

        const errors = parseXcodeBuildErrors(combinedOutput);
        const errorDetail = formatErrors(errors);
        const errorMessage = errorDetail
          ? `Build failed: ${errorDetail}`
          : `Build failed:\n${combinedOutput.trim().slice(-800)}`;
        return {
          success: false,
          error: errorMessage,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info('Build succeeded. Finding app bundle...');

      // Step 3: Find the built .app bundle in DerivedData
      let appBundlePath = '';
      let bundleId = '';

      // Get build settings to find the app path and bundle ID
      const settingsArgs: string[] = [
        isWorkspace ? '-workspace' : '-project',
        projectPath,
        '-showBuildSettings',
        '-configuration', 'Debug',
        '-destination', `id=${simulatorUDID}`,
      ];
      if (scheme) settingsArgs.push('-scheme', scheme);

      const settingsResult = await execXcode('xcodebuild', settingsArgs);
      if (settingsResult.exitCode === 0) {
        const builtProductsMatch = settingsResult.stdout.match(/\bBUILT_PRODUCTS_DIR\s*=\s*(.+)/);
        const productNameMatch = settingsResult.stdout.match(/\bFULL_PRODUCT_NAME\s*=\s*(.+)/);
        const bundleIdMatch = settingsResult.stdout.match(/\bPRODUCT_BUNDLE_IDENTIFIER\s*=\s*(.+)/);

        if (builtProductsMatch && productNameMatch) {
          appBundlePath = join(builtProductsMatch[1].trim(), productNameMatch[1].trim());
        }
        if (bundleIdMatch) {
          bundleId = bundleIdMatch[1].trim();
        }
      }

      // Step 4: Install and launch the app
      let launched = false;
      let launchMessage = '';

      if (appBundlePath && existsSync(appBundlePath)) {
        logger.info(`Installing app: ${appBundlePath}`);

        const installResult = await execSimctl(['install', simulatorUDID, appBundlePath]);
        if (installResult.exitCode === 0) {
          logger.info('App installed successfully');

          if (bundleId) {
            logger.info(`Launching app: ${bundleId}`);
            const launchResult = await execSimctl(['launch', simulatorUDID, bundleId]);
            if (launchResult.exitCode === 0) {
              launched = true;
              launchMessage = `App "${bundleId}" laeuft jetzt auf ${simulatorName}`;
              logger.info(launchMessage);
            } else {
              launchMessage = `App installiert aber Start fehlgeschlagen: ${launchResult.stderr.trim().slice(-200)}`;
              logger.warn(launchMessage);
            }
          } else {
            launchMessage = 'App installiert, aber Bundle-ID konnte nicht ermittelt werden. Bitte manuell starten.';
          }
        } else {
          launchMessage = `App-Installation fehlgeschlagen: ${installResult.stderr.trim().slice(-200)}`;
          logger.warn(launchMessage);
        }
      } else {
        launchMessage = `App-Bundle nicht gefunden unter: ${appBundlePath || 'unbekannt'}. Build war erfolgreich - App kann manuell gestartet werden.`;
        logger.warn(launchMessage);
      }

      return {
        success: true,
        data: {
          projectPath,
          scheme: scheme || 'default',
          simulator: simulatorName,
          simulatorUDID,
          appBundlePath,
          bundleId,
          launched,
          buildDuration: buildResult.duration,
          message: launched
            ? `App erfolgreich gebaut und auf ${simulatorName} gestartet!`
            : launchMessage,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in run-on-simulator:', error);

      return {
        success: false,
        error: `Failed to run on simulator: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Archive-project tool
 * Create an archive for distribution
 */
const archiveProject: ToolDefinition = {
  name: 'archive-project',
  description: 'Create an archive of the project for distribution or upload to TestFlight/App Store.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Optional path to .xcodeproj or .xcworkspace.',
      },
      scheme: {
        type: 'string',
        description: 'Build scheme to archive. Required for most projects.',
      },
      configuration: {
        type: 'string',
        description: 'Build configuration. Defaults to Release.',
      },
      outputPath: {
        type: 'string',
        description: 'Optional output directory for archive. Defaults to current directory.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      // Check if xcodebuild is functional
      const xcodeError = await checkXcodebuild();
      if (xcodeError) {
        return { success: false, error: xcodeError, data: null, executionTime: Date.now() - startTime };
      }

      let projectPath = args.projectPath as string | undefined;
      const scheme = args.scheme as string | undefined;
      const configuration = (args.configuration as Configuration) || 'Release';
      let outputPath = args.outputPath as string | undefined;

      // Find project if not provided
      if (!projectPath) {
        projectPath = await findProjectPath();
        if (!projectPath) {
          return {
            success: false,
            error: 'Could not find .xcodeproj or .xcworkspace in current directory',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }
      }

      if (!scheme) {
        return {
          success: false,
          error: 'Scheme is required for archiving',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      outputPath = outputPath || process.cwd();
      const archivePath = join(outputPath, `${scheme}.xcarchive`);

      logger.info(`Archiving project: ${projectPath}`);

      const isWorkspace = projectPath.endsWith('.xcworkspace');
      const archiveArgs: string[] = [
        isWorkspace ? '-workspace' : '-project',
        projectPath,
        '-scheme',
        scheme,
        'archive',
        '-configuration',
        configuration,
        '-archivePath',
        archivePath,
      ];

      const archiveResult = await execXcode('xcodebuild', archiveArgs);

      if (archiveResult.exitCode !== 0) {
        const combinedArchOutput = archiveResult.stderr + '\n' + archiveResult.stdout;

        // Check for missing platform SDK (Xcode 26+)
        const platformError = await detectMissingPlatform(combinedArchOutput);
        if (platformError) {
          return { success: false, error: platformError, data: null, executionTime: Date.now() - startTime };
        }

        const errors = parseXcodeBuildErrors(combinedArchOutput);
        const archErrorDetail = formatErrors(errors);
        const archErrorMsg = archErrorDetail
          ? `Archive failed: ${archErrorDetail}`
          : `Archive failed:\n${combinedArchOutput.trim().slice(-800)}`;
        return {
          success: false,
          error: archErrorMsg,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Get archive info
      const infoPath = join(archivePath, 'Info.plist');
      const archiveInfo: Partial<ArchiveInfo> = {
        path: archivePath,
        scheme,
      };

      if (existsSync(infoPath)) {
        const stat = statSync(archivePath);
        archiveInfo.size = stat.size;
      }

      logger.info(`Archive created successfully: ${archivePath}`);

      return {
        success: true,
        data: archiveInfo,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in archive-project:', error);

      return {
        success: false,
        error: `Failed to archive project: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Analyze-project tool
 * Run static analysis on project
 */
const analyzeProject: ToolDefinition = {
  name: 'analyze-project',
  description: 'Run static analysis on project using xcodebuild analyze to detect potential issues.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Optional path to .xcodeproj or .xcworkspace.',
      },
      scheme: {
        type: 'string',
        description: 'Build scheme to analyze. Optional.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      // Check if xcodebuild is functional
      const xcodeError = await checkXcodebuild();
      if (xcodeError) {
        return { success: false, error: xcodeError, data: null, executionTime: Date.now() - startTime };
      }

      let projectPath = args.projectPath as string | undefined;
      const scheme = args.scheme as string | undefined;

      // Find project if not provided
      if (!projectPath) {
        projectPath = await findProjectPath();
        if (!projectPath) {
          return {
            success: false,
            error: 'Could not find .xcodeproj or .xcworkspace in current directory',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }
      }

      logger.info(`Analyzing project: ${projectPath}`);

      const isWorkspace = projectPath.endsWith('.xcworkspace');
      const analyzeArgs: string[] = [
        isWorkspace ? '-workspace' : '-project',
        projectPath,
        'analyze',
      ];

      if (scheme) {
        analyzeArgs.push('-scheme', scheme);
      }

      const analyzeResult = await execXcode('xcodebuild', analyzeArgs);

      // Parse analysis output
      const combinedAnalyzeOutput = analyzeResult.stderr + '\n' + analyzeResult.stdout;
      const errors = parseXcodeBuildErrors(combinedAnalyzeOutput);

      // Handle analysis failure
      if (analyzeResult.exitCode !== 0 && errors.length === 0) {
        return {
          success: false,
          error: `Analysis failed:\n${combinedAnalyzeOutput.trim().slice(-800)}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const issues = errors.map((error) => ({
        severity: error.type,
        message: error.message,
        file: error.file,
        line: error.line,
        column: error.column,
        suggestions: error.suggestions,
      }));

      logger.info(`Analysis completed with ${issues.length} issues`);

      return {
        success: analyzeResult.exitCode === 0,
        data: {
          projectPath,
          scheme: scheme || 'default',
          issues,
          issueCount: issues.length,
          duration: analyzeResult.duration,
        },
        warnings: issues.length > 0 ? [formatErrors(errors)] : undefined,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in analyze-project:', error);

      return {
        success: false,
        error: `Failed to analyze project: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Export all build tools
 */
export const tools: ToolDefinition[] = [
  buildProject,
  buildUniversalBinary,
  cleanBuild,
  runOnSimulator,
  archiveProject,
  analyzeProject,
];

export default tools;
