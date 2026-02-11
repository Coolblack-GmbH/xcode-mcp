import { ToolResult, ToolHandler } from '../types.js';
import { execCommand, execXcode } from '../utils/exec.js';
import { logger } from '../utils/logger.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * list-connected-devices — List physical devices connected via USB or Wi-Fi
 */
const listConnectedDevices: ToolDefinition = {
  name: 'list-connected-devices',
  description: 'List physical Apple devices connected via USB or Wi-Fi. Uses devicectl (Xcode 15+) with fallback to xctrace.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async (_args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      logger.info('Listing connected physical devices');

      // Try devicectl first (Xcode 15+)
      const devicectlResult = await execCommand('xcrun', ['devicectl', 'list', 'devices', '--json-output', '/dev/stdout'], {
        timeout: 30000,
      });

      if (devicectlResult.exitCode === 0 && devicectlResult.stdout.trim()) {
        try {
          const json = JSON.parse(devicectlResult.stdout);
          const devices = (json.result?.devices || []).map((d: any) => ({
            udid: d.hardwareProperties?.udid || d.identifier || 'unknown',
            name: d.deviceProperties?.name || 'Unknown Device',
            model: d.hardwareProperties?.marketingName || d.hardwareProperties?.productType || 'Unknown',
            osVersion: d.deviceProperties?.osVersionNumber || 'Unknown',
            connectionType: d.connectionProperties?.transportType || 'unknown',
            state: d.deviceProperties?.developerModeStatus === 'enabled' ? 'available' : 'check-developer-mode',
          }));

          return {
            success: true,
            data: { devices, count: devices.length, source: 'devicectl' },
            executionTime: Date.now() - startTime,
          };
        } catch {
          // JSON parse failed, try fallback
        }
      }

      // Fallback: xctrace list devices
      const xtraceResult = await execCommand('xcrun', ['xctrace', 'list', 'devices'], {
        timeout: 30000,
      });

      if (xtraceResult.exitCode !== 0) {
        return {
          success: false,
          error: `Konnte keine Geraete auflisten: ${xtraceResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const lines = xtraceResult.stdout.split('\n');
      const devices: Array<{ name: string; udid: string; info: string }> = [];
      let inDevicesSection = false;

      for (const line of lines) {
        if (line.includes('== Devices ==')) {
          inDevicesSection = true;
          continue;
        }
        if (line.includes('== Simulators ==')) {
          break;
        }
        if (inDevicesSection && line.trim()) {
          const match = line.match(/^(.+?)\s+\(([^)]+)\)\s*$/);
          if (match) {
            devices.push({
              name: match[1].trim(),
              udid: match[2].trim(),
              info: line.trim(),
            });
          }
        }
      }

      return {
        success: true,
        data: { devices, count: devices.length, source: 'xctrace' },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in list-connected-devices:', error);
      return {
        success: false,
        error: `Fehler beim Auflisten der Geraete: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * deploy-to-device — Build, install, and optionally launch an app on a physical device
 */
const deployToDevice: ToolDefinition = {
  name: 'deploy-to-device',
  description: 'Build, install, and optionally launch an app on a physical device. Requires a connected device UDID.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to .xcodeproj or .xcworkspace',
      },
      scheme: {
        type: 'string',
        description: 'Build scheme name',
      },
      deviceUdid: {
        type: 'string',
        description: 'UDID of the target physical device',
      },
      configuration: {
        type: 'string',
        enum: ['Debug', 'Release'],
        description: 'Build configuration (default: Debug)',
      },
      bundleId: {
        type: 'string',
        description: 'Bundle ID for launching the app (optional, auto-detected from build settings)',
      },
      launch: {
        type: 'boolean',
        description: 'Launch the app after installation (default: true)',
      },
    },
    required: ['projectPath', 'scheme', 'deviceUdid'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const projectPath = args.projectPath as string;
      const scheme = args.scheme as string;
      const deviceUdid = args.deviceUdid as string;
      const configuration = (args.configuration as string) || 'Debug';
      const launch = args.launch !== false;
      let bundleId = args.bundleId as string | undefined;

      logger.info(`Deploying ${scheme} to device ${deviceUdid}`);

      // Step 1: Build for the device
      const projectType = projectPath.endsWith('.xcworkspace') ? 'workspace' : 'project';
      const buildResult = await execXcode('xcodebuild', [
        `-${projectType}`, projectPath,
        '-scheme', scheme,
        '-configuration', configuration,
        '-destination', `id=${deviceUdid}`,
        '-derivedDataPath', 'build',
        'build',
      ], { cwd: projectPath.replace(/\/[^/]+\.(xcodeproj|xcworkspace)$/, '') });

      if (buildResult.exitCode !== 0) {
        return {
          success: false,
          error: `Build fehlgeschlagen: ${buildResult.stderr.substring(0, 500)}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Step 2: Find the .app bundle
      const appPathResult = await execCommand('find', [
        'build/Build/Products',
        '-name', '*.app',
        '-maxdepth', '3',
      ], { cwd: projectPath.replace(/\/[^/]+\.(xcodeproj|xcworkspace)$/, '') });

      const appPath = appPathResult.stdout.trim().split('\n')[0];
      if (!appPath) {
        return {
          success: false,
          error: 'Konnte das gebaute .app Bundle nicht finden',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Step 3: Install on device via devicectl
      const installResult = await execCommand('xcrun', [
        'devicectl', 'device', 'install', 'app',
        '--device', deviceUdid,
        appPath,
      ], { timeout: 120000 });

      if (installResult.exitCode !== 0) {
        return {
          success: false,
          error: `Installation fehlgeschlagen: ${installResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Step 4: Launch if requested
      let launchOutput = '';
      if (launch) {
        // Auto-detect bundleId from build settings if not provided
        if (!bundleId) {
          const settingsResult = await execXcode('xcodebuild', [
            `-${projectType}`, projectPath,
            '-scheme', scheme,
            '-showBuildSettings',
          ]);
          const match = settingsResult.stdout.match(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*(.+)/);
          bundleId = match ? match[1].trim() : undefined;
        }

        if (bundleId) {
          const launchResult = await execCommand('xcrun', [
            'devicectl', 'device', 'process', 'launch',
            '--device', deviceUdid,
            bundleId,
          ], { timeout: 30000 });
          launchOutput = launchResult.stdout;
        }
      }

      return {
        success: true,
        data: {
          scheme,
          deviceUdid,
          configuration,
          appPath,
          bundleId,
          launched: launch && !!bundleId,
          launchOutput,
          message: `App erfolgreich auf Geraet ${deviceUdid} installiert${launch && bundleId ? ' und gestartet' : ''}`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in deploy-to-device:', error);
      return {
        success: false,
        error: `Deployment fehlgeschlagen: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * read-device-logs — Read logs from a connected physical device
 */
const readDeviceLogs: ToolDefinition = {
  name: 'read-device-logs',
  description: 'Read system or app logs from a connected physical device. Supports filtering by bundle ID and process name.',
  inputSchema: {
    type: 'object',
    properties: {
      deviceUdid: {
        type: 'string',
        description: 'UDID of the target device',
      },
      bundleId: {
        type: 'string',
        description: 'Filter logs by bundle identifier (optional)',
      },
      processName: {
        type: 'string',
        description: 'Filter logs by process name (optional)',
      },
      lastMinutes: {
        type: 'number',
        description: 'Show logs from the last N minutes (default: 5)',
      },
    },
    required: ['deviceUdid'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const deviceUdid = args.deviceUdid as string;
      const bundleId = args.bundleId as string | undefined;
      const processName = args.processName as string | undefined;
      const lastMinutes = (args.lastMinutes as number) || 5;

      logger.info(`Reading logs from device ${deviceUdid}`);

      // Build predicate for log filtering
      const predicateParts: string[] = [];
      if (bundleId) {
        predicateParts.push(`subsystem == "${bundleId}"`);
      }
      if (processName) {
        predicateParts.push(`process == "${processName}"`);
      }

      const logArgs = [
        'devicectl', 'device', 'info', 'dmesg',
        '--device', deviceUdid,
      ];

      // Try devicectl first
      let result = await execCommand('xcrun', logArgs, { timeout: 30000 });

      // Fallback: use log command via devicectl
      if (result.exitCode !== 0) {
        const startDate = new Date(Date.now() - lastMinutes * 60 * 1000).toISOString();
        const osLogArgs = [
          'log', 'show',
          '--start', startDate,
          '--style', 'compact',
        ];

        if (predicateParts.length > 0) {
          osLogArgs.push('--predicate', predicateParts.join(' AND '));
        }

        // This works for simulators and locally; for devices we may need alternative approach
        result = await execCommand('xcrun', osLogArgs, { timeout: 60000 });
      }

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: `Konnte Geraete-Logs nicht lesen: ${result.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const logLines = result.stdout.split('\n');

      return {
        success: true,
        data: {
          deviceUdid,
          lineCount: logLines.length,
          filters: { bundleId, processName, lastMinutes },
          logs: result.stdout.substring(0, 50000), // Limit output size
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in read-device-logs:', error);
      return {
        success: false,
        error: `Fehler beim Lesen der Geraete-Logs: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

export const deviceTools: ToolDefinition[] = [
  listConnectedDevices,
  deployToDevice,
  readDeviceLogs,
];

export default deviceTools;
