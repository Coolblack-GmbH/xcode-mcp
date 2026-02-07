import { ToolResult, ToolHandler } from '../types.js';
import { execCommand, execXcode, ExecResult } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
 * get-xcode-version tool
 * Get Xcode version information including build number and path
 */
const getXcodeVersion: ToolDefinition = {
  name: 'get-xcode-version',
  description: 'Get Xcode version information including version number, build number, and installation path.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      logger.info('Retrieving Xcode version information');

      // Get Xcode version and build
      const versionResult = await execXcode('xcodebuild', ['-version']);

      if (versionResult.exitCode !== 0) {
        logger.error('Failed to get Xcode version:', versionResult.stderr);
        return {
          success: false,
          error: `Failed to get Xcode version: ${versionResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Get Xcode path
      const pathResult = await execXcode('xcode-select', ['--print-path']);

      if (pathResult.exitCode !== 0) {
        logger.error('Failed to get Xcode path:', pathResult.stderr);
        return {
          success: false,
          error: `Failed to get Xcode path: ${pathResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Parse version output
      const versionLines = versionResult.stdout.trim().split('\n');
      const versionInfo: Record<string, string> = {};

      for (const line of versionLines) {
        const [key, ...valueParts] = line.split(':').map(s => s.trim());
        if (key && valueParts.length > 0) {
          versionInfo[key.toLowerCase().replace(/\s+/g, '_')] = valueParts.join(':').trim();
        }
      }

      const xcodeVersion = versionInfo.xcode || 'unknown';
      const buildNumber = versionInfo.build || 'unknown';
      const xcodeePath = pathResult.stdout.trim();

      logger.info(`Xcode version: ${xcodeVersion}, Build: ${buildNumber}, Path: ${xcodeePath}`);

      return {
        success: true,
        data: {
          version: xcodeVersion,
          buildNumber: buildNumber,
          path: xcodeePath,
          fullOutput: versionResult.stdout.trim(),
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in get-xcode-version:', error);

      return {
        success: false,
        error: `Failed to get Xcode version: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * validate-bundle-id tool
 * Validate iOS/macOS bundle ID format
 */
const validateBundleId: ToolDefinition = {
  name: 'validate-bundle-id',
  description: 'Validate iOS/macOS bundle ID format. Checks for correct reverse DNS notation and allowed characters.',
  inputSchema: {
    type: 'object',
    properties: {
      bundleId: {
        type: 'string',
        description: 'Bundle ID to validate (e.g., com.example.myapp)',
      },
    },
    required: ['bundleId'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const bundleId = args.bundleId as string;

      if (!bundleId || typeof bundleId !== 'string') {
        return {
          success: false,
          error: 'bundleId must be a non-empty string',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Validating bundle ID: ${bundleId}`);

      // Bundle ID validation rules:
      // - Must be in reverse DNS notation (com.company.app)
      // - Each segment must start with a lowercase letter or digit
      // - Can contain lowercase letters, digits, and hyphens
      // - Minimum 3 segments (domain.company.app)
      const bundleIdPattern = /^[a-z]([a-z0-9-]*\.)*[a-z]([a-z0-9-]*)?$/i;
      const isValid = bundleIdPattern.test(bundleId);

      const segments = bundleId.split('.');
      const issues: string[] = [];
      const suggestions: string[] = [];

      // Check segment count
      if (segments.length < 2) {
        issues.push('Bundle ID must have at least 2 segments separated by dots');
        suggestions.push(`Try: com.example.${bundleId}`);
      }

      // Check each segment
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];

        if (!segment) {
          issues.push(`Segment ${i + 1} is empty`);
          continue;
        }

        if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(segment)) {
          issues.push(`Segment ${i + 1} '${segment}' contains invalid characters. Use only letters, digits, and hyphens.`);
        }

        if (/^[0-9]/.test(segment)) {
          issues.push(`Segment ${i + 1} '${segment}' starts with a digit. Should start with a letter.`);
        }
      }

      // Check for reserved words
      const reservedWords = ['test', 'example', 'localhost', 'local'];
      for (const word of reservedWords) {
        if (segments.some(s => s.toLowerCase() === word)) {
          issues.push(`Contains reserved word '${word}'`);
        }
      }

      return {
        success: issues.length === 0,
        data: {
          bundleId,
          isValid: issues.length === 0,
          segments,
          segmentCount: segments.length,
          issues: issues.length > 0 ? issues : undefined,
          suggestions: suggestions.length > 0 ? suggestions : undefined,
        },
        warnings: issues.length > 0 ? issues : undefined,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in validate-bundle-id:', error);

      return {
        success: false,
        error: `Failed to validate bundle ID: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * convert-to-pkg tool
 * Convert app to PKG installer (macOS)
 */
const convertToPkg: ToolDefinition = {
  name: 'convert-to-pkg',
  description: 'Convert macOS .app bundle to PKG installer format. Optionally sign the package with a certificate identity.',
  inputSchema: {
    type: 'object',
    properties: {
      appPath: {
        type: 'string',
        description: 'Path to the .app bundle to convert',
      },
      outputPath: {
        type: 'string',
        description: 'Output path for the PKG file. If not specified, uses current directory with app name.',
      },
      identity: {
        type: 'string',
        description: 'Optional code signing identity for the package (e.g., "Developer ID Installer")',
      },
    },
    required: ['appPath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const appPath = args.appPath as string;
      let outputPath = args.outputPath as string | undefined;
      const identity = args.identity as string | undefined;

      if (!appPath || typeof appPath !== 'string') {
        return {
          success: false,
          error: 'appPath must be a non-empty string',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Converting app to PKG: ${appPath}`);

      // Determine output path
      if (!outputPath) {
        const appName = appPath.split('/').pop()?.replace('.app', '') || 'app';
        outputPath = `./${appName}.pkg`;
      }

      const cmd = ['productbuild', '--component', appPath, '/Applications', outputPath];

      // Add signing if identity provided
      if (identity) {
        cmd.splice(1, 0, '--sign', identity);
        logger.info(`Signing package with identity: ${identity}`);
      }

      const result = await execCommand(cmd[0], cmd.slice(1));

      if (result.exitCode !== 0) {
        logger.error('Failed to convert to PKG:', result.stderr);
        return {
          success: false,
          error: `Failed to convert to PKG: ${result.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Successfully created PKG: ${outputPath}`);

      return {
        success: true,
        data: {
          appPath: resolve(appPath),
          outputPath: resolve(outputPath),
          signed: !!identity,
          identity: identity || null,
          command: cmd.join(' '),
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in convert-to-pkg:', error);

      return {
        success: false,
        error: `Failed to convert to PKG: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * get-sdk-info tool
 * Get installed SDK information
 */
const getSdkInfo: ToolDefinition = {
  name: 'get-sdk-info',
  description: 'Get information about installed SDKs. Optionally filter by platform (iphoneos, iphonesimulator, macosx, watchos, tvos).',
  inputSchema: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        description: 'Optional platform to filter by (iphoneos, iphonesimulator, macosx, watchos, tvos)',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const platform = args.platform as string | undefined;

      logger.info('Retrieving SDK information');

      const result = await execXcode('xcodebuild', ['-showsdks']);

      if (result.exitCode !== 0) {
        logger.error('Failed to get SDK info:', result.stderr);
        return {
          success: false,
          error: `Failed to get SDK info: ${result.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Parse SDK output
      const sdks: Array<{ platform: string; version: string; path: string }> = [];
      const lines = result.stdout.trim().split('\n');

      for (const line of lines) {
        const match = line.match(/^(-\s+)?([^\s]+)\s+(.+?)\s+\(at\s+(.+)\)$/);
        if (match) {
          const [, , sdkPlatform, version, path] = match;
          sdks.push({
            platform: sdkPlatform,
            version: version.trim(),
            path: path.trim(),
          });
        }
      }

      // Filter by platform if specified
      let filtered = sdks;
      if (platform) {
        filtered = sdks.filter(sdk => sdk.platform.includes(platform));
        logger.info(`Filtered SDKs for platform: ${platform}`);
      }

      return {
        success: true,
        data: {
          sdks: filtered,
          totalCount: sdks.length,
          filteredCount: filtered.length,
          filter: platform || null,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in get-sdk-info:', error);

      return {
        success: false,
        error: `Failed to get SDK info: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * list-device-types tool
 * List available simulator device types and runtimes
 */
const listDeviceTypes: ToolDefinition = {
  name: 'list-device-types',
  description: 'List all available simulator device types and OS runtimes. Useful for understanding available simulation targets.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      logger.info('Retrieving simulator device types and runtimes');

      // Get device types
      const deviceTypesResult = await execCommand('xcrun', ['simctl', 'list', 'devicetypes', '-j']);

      if (deviceTypesResult.exitCode !== 0) {
        logger.error('Failed to get device types:', deviceTypesResult.stderr);
        return {
          success: false,
          error: `Failed to get device types: ${deviceTypesResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Get runtimes
      const runtimesResult = await execCommand('xcrun', ['simctl', 'list', 'runtimes', '-j']);

      if (runtimesResult.exitCode !== 0) {
        logger.error('Failed to get runtimes:', runtimesResult.stderr);
        return {
          success: false,
          error: `Failed to get runtimes: ${runtimesResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Parse JSON output
      let deviceTypes: Array<any> = [];
      let runtimes: Array<any> = [];

      try {
        const deviceTypesData = JSON.parse(deviceTypesResult.stdout);
        deviceTypes = deviceTypesData.devicetypes || [];
        logger.info(`Found ${deviceTypes.length} device types`);
      } catch (e) {
        logger.warn('Failed to parse device types JSON');
      }

      try {
        const runtimesData = JSON.parse(runtimesResult.stdout);
        runtimes = runtimesData.runtimes || [];
        logger.info(`Found ${runtimes.length} runtimes`);
      } catch (e) {
        logger.warn('Failed to parse runtimes JSON');
      }

      // Group runtimes by platform
      const runtimesByPlatform: Record<string, any[]> = {};
      for (const runtime of runtimes) {
        if (runtime.isAvailable) {
          const platform = runtime.supportedDeviceTypes?.[0]?.identifier || 'unknown';
          if (!runtimesByPlatform[platform]) {
            runtimesByPlatform[platform] = [];
          }
          runtimesByPlatform[platform].push(runtime);
        }
      }

      return {
        success: true,
        data: {
          deviceTypes: deviceTypes.map(dt => ({
            identifier: dt.identifier,
            name: dt.name,
            productFamily: dt.productFamily,
          })),
          runtimes: runtimes.filter(r => r.isAvailable).map(r => ({
            identifier: r.identifier,
            version: r.version,
            buildVersion: r.buildversion,
            isAvailable: r.isAvailable,
          })),
          runtimesByPlatform: Object.fromEntries(
            Object.entries(runtimesByPlatform).map(([platform, rts]) => [
              platform,
              rts.map(r => ({ version: r.version, buildVersion: r.buildversion })),
            ])
          ),
          summary: {
            totalDeviceTypes: deviceTypes.length,
            totalRuntimes: runtimes.length,
            availableRuntimes: runtimes.filter(r => r.isAvailable).length,
          },
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in list-device-types:', error);

      return {
        success: false,
        error: `Failed to list device types: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Export all utility tools
 */
export const utilityTools: ToolDefinition[] = [
  getXcodeVersion,
  validateBundleId,
  convertToPkg,
  getSdkInfo,
  listDeviceTypes,
];

export default utilityTools;
