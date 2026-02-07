import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';

/**
 * Result of a subprocess execution
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

/**
 * Options for executing a command
 */
export interface ExecOptions {
  timeout?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/**
 * Execute a command using execFile with separate stdout/stderr capture
 * @param command The command to execute
 * @param args Arguments for the command
 * @param options Execution options
 * @returns Structured execution result
 */
export async function execCommand(
  command: string,
  args: string[] = [],
  options: ExecOptions = {},
): Promise<ExecResult> {
  const startTime = Date.now();
  const timeout = options.timeout ?? 120000; // Default 120 seconds

  try {
    logger.debug(`Executing command: ${command} ${args.join(' ')}`);

    const result = await execFileAsync(command, args, {
      timeout,
      cwd: options.cwd,
      env: options.env,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    const duration = Date.now() - startTime;

    return {
      stdout: result.stdout,
      stderr: result.stderr || '',
      exitCode: 0,
      duration,
    };
  } catch (error: unknown) {
    const duration = Date.now() - startTime;

    if (error instanceof Error) {
      // execFile throws on non-zero exit codes
      const execError = error as any;

      logger.debug(`Command failed: ${command}`, {
        code: execError.code,
        signal: execError.signal,
      });

      return {
        stdout: execError.stdout || '',
        stderr: execError.stderr || '',
        exitCode: execError.code || 1,
        duration,
      };
    }

    logger.error(`Unexpected error executing command: ${command}`, error);
    return {
      stdout: '',
      stderr: `Error executing command: ${String(error)}`,
      exitCode: 1,
      duration,
    };
  }
}

/**
 * Execute a shell command using exec
 * @param command The shell command to execute
 * @param options Execution options
 * @returns Structured execution result
 */
export async function execShell(command: string, options: ExecOptions = {}): Promise<ExecResult> {
  const startTime = Date.now();
  const timeout = options.timeout ?? 120000; // Default 120 seconds

  try {
    logger.debug(`Executing shell command: ${command}`);

    const result = await execAsync(command, {
      timeout,
      cwd: options.cwd,
      env: options.env,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    const duration = Date.now() - startTime;

    return {
      stdout: result.stdout,
      stderr: result.stderr || '',
      exitCode: 0,
      duration,
    };
  } catch (error: unknown) {
    const duration = Date.now() - startTime;

    if (error instanceof Error) {
      const execError = error as any;

      logger.debug(`Shell command failed: ${command}`, {
        code: execError.code,
        signal: execError.signal,
      });

      return {
        stdout: execError.stdout || '',
        stderr: execError.stderr || '',
        exitCode: execError.code || 1,
        duration,
      };
    }

    logger.error(`Unexpected error executing shell command: ${command}`, error);
    return {
      stdout: '',
      stderr: `Error executing shell command: ${String(error)}`,
      exitCode: 1,
      duration,
    };
  }
}

/**
 * Execute an Xcode command (xcodebuild, xcrun, or xcode-select)
 * @param command The Xcode command (xcodebuild, xcrun, xcode-select, etc.)
 * @param args Arguments for the command
 * @param options Execution options
 * @returns Structured execution result
 */
export async function execXcode(
  command: 'xcodebuild' | 'xcrun' | 'xcode-select' | string,
  args: string[] = [],
  options: ExecOptions = {},
): Promise<ExecResult> {
  // Use longer timeout for Xcode commands
  const xcodeOptions: ExecOptions = {
    ...options,
    timeout: options.timeout ?? 600000, // Default 10 minutes for Xcode
  };

  logger.debug(`Executing Xcode command: ${command}`);

  const result = await execCommand(command, args, xcodeOptions);

  if (result.exitCode !== 0) {
    logger.warn(`Xcode command failed: ${command}`, {
      exitCode: result.exitCode,
      stderr: result.stderr.substring(0, 200), // Log first 200 chars
    });
  }

  return result;
}

/**
 * Execute a simctl command (for iOS simulator management)
 * @param args Arguments for simctl
 * @param options Execution options
 * @returns Structured execution result
 */
export async function execSimctl(
  args: string[] = [],
  options: ExecOptions = {},
): Promise<ExecResult> {
  const simctlOptions: ExecOptions = {
    ...options,
    timeout: options.timeout ?? 300000, // Default 5 minutes for simctl
  };

  logger.debug(`Executing simctl command with args:`, args);

  const result = await execCommand('xcrun', ['simctl', ...args], simctlOptions);

  if (result.exitCode !== 0) {
    logger.warn(`Simctl command failed`, {
      exitCode: result.exitCode,
      stderr: result.stderr.substring(0, 200),
    });
  }

  return result;
}

/**
 * Check if xcodebuild is available and functional (Xcode.app installed)
 * @returns Error message string if not available, null if OK
 */
export async function checkXcodebuild(): Promise<string | null> {
  const check = await execXcode('xcodebuild', ['-version']);
  if (check.exitCode !== 0) {
    const stderr = check.stderr || '';
    if (stderr.includes('requires Xcode') || stderr.includes('command line tools instance')) {
      return 'Xcode.app ist nicht installiert. Bitte Xcode aus dem App Store installieren und danach ausfuehren: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer';
    }
    return `xcodebuild nicht verfuegbar: ${stderr.trim().slice(-200)}`;
  }
  return null; // OK
}

/**
 * Check if a specific platform SDK is installed in Xcode
 * In Xcode 26+, platform SDKs must be downloaded separately
 * @param platform - Platform to check (iOS, macOS, watchOS, tvOS, visionOS)
 * @returns Object with installed status and details
 */
export async function checkPlatformSDK(platform: string): Promise<{
  installed: boolean;
  sdkPath?: string;
  error?: string;
}> {
  // Map platform names to SDK names
  const sdkMap: Record<string, string> = {
    iOS: 'iphoneos',
    macOS: 'macosx',
    watchOS: 'watchos',
    tvOS: 'appletvos',
    visionOS: 'xros',
  };

  const sdk = sdkMap[platform] || platform.toLowerCase();

  const result = await execCommand('xcrun', ['--sdk', sdk, '--show-sdk-path']);
  if (result.exitCode === 0 && result.stdout.trim()) {
    return { installed: true, sdkPath: result.stdout.trim() };
  }

  // Also check simulator SDK for iOS/watchOS/tvOS/visionOS
  const simSdkMap: Record<string, string> = {
    iOS: 'iphonesimulator',
    watchOS: 'watchsimulator',
    tvOS: 'appletvsimulator',
    visionOS: 'xrsimulator',
  };

  const simSdk = simSdkMap[platform];
  if (simSdk) {
    const simResult = await execCommand('xcrun', ['--sdk', simSdk, '--show-sdk-path']);
    if (simResult.exitCode === 0 && simResult.stdout.trim()) {
      return { installed: true, sdkPath: simResult.stdout.trim() };
    }
  }

  return {
    installed: false,
    error: `${platform}-Plattform ist nicht installiert. Bitte mit 'xcodebuild -downloadPlatform ${platform}' herunterladen.`,
  };
}

/**
 * Check if a simulator runtime matching the installed SDK is available.
 * In Xcode 26+, the SDK may be installed but the simulator runtime needs
 * to be downloaded separately (8+ GB).
 * @param platform - Platform to check (iOS, watchOS, tvOS, visionOS)
 * @returns Object with runtime availability details
 */
export async function checkSimulatorRuntime(platform: string): Promise<{
  available: boolean;
  sdkVersion?: string;
  runtimeVersion?: string;
  error?: string;
}> {
  // Get the SDK version from xcodebuild
  const sdksResult = await execCommand('xcodebuild', ['-showsdks', '-json']);
  let sdkVersion = '';

  if (sdksResult.exitCode === 0) {
    try {
      // Parse to find the simulator SDK version
      const simSdkMap: Record<string, string> = {
        iOS: 'iphonesimulator',
        watchOS: 'watchsimulator',
        tvOS: 'appletvsimulator',
        visionOS: 'xrsimulator',
      };
      const sdkPrefix = simSdkMap[platform] || 'iphonesimulator';

      // Try to extract version from text output instead if JSON fails
      const textResult = await execCommand('xcodebuild', ['-showsdks']);
      if (textResult.exitCode === 0) {
        const sdkMatch = textResult.stdout.match(new RegExp(`-sdk\\s+${sdkPrefix}(\\d+\\.\\d+)`));
        if (sdkMatch) {
          sdkVersion = sdkMatch[1];
        }
      }
    } catch {
      // Fall through to non-JSON approach
    }
  }

  // Get available simulator runtimes
  const runtimesResult = await execSimctl(['list', 'runtimes', '-j']);
  if (runtimesResult.exitCode !== 0) {
    return { available: false, error: 'Konnte Simulator-Runtimes nicht abfragen.' };
  }

  try {
    const data = JSON.parse(runtimesResult.stdout);
    const runtimes = data.runtimes || [];

    // Find runtimes matching the platform
    const platformRuntimes = runtimes.filter((rt: any) => {
      const name = (rt.name || '').toLowerCase();
      const identifier = (rt.identifier || '').toLowerCase();
      return name.includes(platform.toLowerCase()) || identifier.includes(platform.toLowerCase());
    });

    if (platformRuntimes.length === 0) {
      return {
        available: false,
        sdkVersion,
        error: `Keine ${platform} Simulator-Runtime installiert. Bitte ausfuehren: xcodebuild -downloadPlatform ${platform}`,
      };
    }

    // Check if any runtime version is compatible with the SDK version
    // For Xcode 26, SDK is 26.x but runtimes can be 18.x (incompatible) or 26.x (compatible)
    const majorSdkVersion = sdkVersion ? parseInt(sdkVersion.split('.')[0]) : 0;

    let compatibleRuntime: any = null;
    for (const rt of platformRuntimes) {
      if (!rt.isAvailable) continue;
      const rtVersion = rt.version || '';
      const rtMajor = parseInt(rtVersion.split('.')[0]);

      // Compatible if same major version as SDK, or if we can't determine (allow)
      if (majorSdkVersion === 0 || rtMajor === majorSdkVersion || Math.abs(rtMajor - majorSdkVersion) <= 2) {
        compatibleRuntime = rt;
        break;
      }
    }

    if (!compatibleRuntime && majorSdkVersion > 0) {
      // SDK is e.g. 26.2 but only 18.x runtimes available
      const availableVersions = platformRuntimes.map((rt: any) => rt.version).join(', ');
      return {
        available: false,
        sdkVersion,
        runtimeVersion: availableVersions,
        error: `${platform} Simulator-Runtime ${sdkVersion} fehlt. Installierte Runtimes (${availableVersions}) sind nicht kompatibel mit SDK ${sdkVersion}.\nBitte ausfuehren: xcodebuild -downloadPlatform ${platform}`,
      };
    }

    return {
      available: true,
      sdkVersion,
      runtimeVersion: compatibleRuntime?.version || platformRuntimes[0]?.version,
    };
  } catch {
    return { available: false, error: 'Konnte Simulator-Runtime-Daten nicht parsen.' };
  }
}
