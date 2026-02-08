import { ToolResult, ToolHandler, Simulator } from '../types.js';
import { execSimctl, ExecResult } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, extname } from 'path';

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
 * Parse simctl list devices JSON output
 */
function parseSimulators(jsonOutput: string): Map<string, Simulator[]> {
  const simulators = new Map<string, Simulator[]>();

  try {
    const parsed = JSON.parse(jsonOutput);
    const devices = parsed.devices || {};

    for (const [runtime, deviceList] of Object.entries(devices)) {
      const simulatorList: Simulator[] = [];

      if (Array.isArray(deviceList)) {
        for (const device of deviceList) {
          const sim: Simulator = {
            udid: device.udid,
            name: device.name,
            deviceType: device.deviceTypeIdentifier || 'unknown',
            osVersion: runtime.split('.').pop() || 'unknown',
            state: device.state as 'Booted' | 'Shutdown' | 'Unavailable',
            isAvailable: device.isAvailable === true,
          };
          simulatorList.push(sim);
        }
      }

      simulators.set(runtime, simulatorList);
    }
  } catch (error) {
    logger.error('Failed to parse simulators JSON:', error);
  }

  return simulators;
}

/**
 * Find simulator by UDID or name
 */
function findSimulator(simulators: Map<string, Simulator[]>, identifier: string): Simulator | null {
  for (const [, deviceList] of simulators) {
    for (const device of deviceList) {
      if (device.udid === identifier || device.name === identifier) {
        return device;
      }
    }
  }
  return null;
}

/**
 * List simulators tool
 * List available and/or booted simulators
 */
const listSimulators: ToolDefinition = {
  name: 'list-simulators',
  description: 'List available and booted iOS simulators. Can filter by available status or boot state.',
  inputSchema: {
    type: 'object',
    properties: {
      availableOnly: {
        type: 'boolean',
        description: 'If true, only return available simulators. Defaults to false.',
      },
      bootedOnly: {
        type: 'boolean',
        description: 'If true, only return booted simulators. Defaults to false.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const availableOnly = (args.availableOnly as boolean) || false;
      const bootedOnly = (args.bootedOnly as boolean) || false;

      logger.info('Listing simulators');

      const result = await execSimctl(['list', 'devices', '-j']);

      if (result.exitCode !== 0) {
        logger.error('Failed to list simulators:', result.stderr);
        return {
          success: false,
          error: `Failed to list simulators: ${result.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const simulatorMap = parseSimulators(result.stdout);
      let allSimulators: Simulator[] = [];

      for (const [, deviceList] of simulatorMap) {
        allSimulators = allSimulators.concat(deviceList);
      }

      // Filter based on criteria
      let filtered = allSimulators;

      if (availableOnly) {
        filtered = filtered.filter((sim) => sim.isAvailable);
      }

      if (bootedOnly) {
        filtered = filtered.filter((sim) => sim.state === 'Booted');
      }

      logger.info(`Found ${filtered.length} simulators`);

      return {
        success: true,
        data: {
          simulators: filtered,
          totalCount: filtered.length,
          allCount: allSimulators.length,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in list-simulators:', error);

      return {
        success: false,
        error: `Failed to list simulators: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Create simulator tool
 * Create a new simulator device
 */
const createSimulator: ToolDefinition = {
  name: 'create-simulator',
  description: 'Create a new iOS simulator device with specified device type and OS version.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the new simulator (e.g., "My iPhone").',
      },
      deviceType: {
        type: 'string',
        description: 'Device type identifier (e.g., "com.apple.CoreSimulator.SimDeviceType.iPhone-15").',
      },
      osVersion: {
        type: 'string',
        description: 'iOS version identifier (e.g., "com.apple.CoreSimulator.SimRuntime.iOS-18-0").',
      },
    },
    required: ['name', 'deviceType', 'osVersion'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const name = args.name as string;
      const deviceType = args.deviceType as string;
      const osVersion = args.osVersion as string;

      if (!name || !deviceType || !osVersion) {
        return {
          success: false,
          error: 'Missing required parameters: name, deviceType, and osVersion',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Creating simulator: ${name} with device type ${deviceType} and OS ${osVersion}`);

      // Validate device type
      const deviceTypesResult = await execSimctl(['list', 'devicetypes', '-j']);
      if (deviceTypesResult.exitCode !== 0) {
        logger.warn('Could not validate device types');
      }

      // Create the simulator
      const createResult = await execSimctl(['create', name, deviceType, osVersion]);

      if (createResult.exitCode !== 0) {
        logger.error('Failed to create simulator:', createResult.stderr);
        return {
          success: false,
          error: `Failed to create simulator: ${createResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const udid = createResult.stdout.trim();

      logger.info(`Simulator created successfully with UDID: ${udid}`);

      return {
        success: true,
        data: {
          name,
          udid,
          deviceType,
          osVersion,
          message: `Successfully created simulator "${name}"`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in create-simulator:', error);

      return {
        success: false,
        error: `Failed to create simulator: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Boot simulator tool
 * Boot a simulator device
 */
const bootSimulator: ToolDefinition = {
  name: 'boot-simulator',
  description: 'Boot an iOS simulator device by UDID or name.',
  inputSchema: {
    type: 'object',
    properties: {
      simulator: {
        type: 'string',
        description: 'Simulator UDID or name to boot.',
      },
    },
    required: ['simulator'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const simulator = args.simulator as string;

      if (!simulator) {
        return {
          success: false,
          error: 'Missing required parameter: simulator',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Booting simulator: ${simulator}`);

      const bootResult = await execSimctl(['boot', simulator]);

      if (bootResult.exitCode !== 0) {
        const stderr = bootResult.stderr.toLowerCase();
        if (stderr.includes('already booted')) {
          logger.info('Simulator is already booted');
          return {
            success: true,
            data: {
              simulator,
              booted: true,
              message: 'Simulator is already booted',
            },
            executionTime: Date.now() - startTime,
          };
        }

        logger.error('Failed to boot simulator:', bootResult.stderr);
        return {
          success: false,
          error: `Failed to boot simulator: ${bootResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Simulator booted successfully: ${simulator}`);

      return {
        success: true,
        data: {
          simulator,
          booted: true,
          message: `Successfully booted simulator "${simulator}"`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in boot-simulator:', error);

      return {
        success: false,
        error: `Failed to boot simulator: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Shutdown simulator tool
 * Shutdown one or all simulators
 */
const shutdownSimulator: ToolDefinition = {
  name: 'shutdown-simulator',
  description: 'Shutdown a specific simulator or all simulators.',
  inputSchema: {
    type: 'object',
    properties: {
      simulator: {
        type: 'string',
        description: 'Simulator UDID or name to shutdown. If omitted and all is false, no action taken.',
      },
      all: {
        type: 'boolean',
        description: 'If true, shutdown all simulators. Defaults to false.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const simulator = args.simulator as string | undefined;
      const all = (args.all as boolean) || false;

      if (!simulator && !all) {
        return {
          success: false,
          error: 'Must provide either simulator or set all to true',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      let shutdownCmd: string[];

      if (all) {
        logger.info('Shutting down all simulators');
        shutdownCmd = ['shutdown', 'all'];
      } else {
        logger.info(`Shutting down simulator: ${simulator}`);
        shutdownCmd = ['shutdown', simulator!];
      }

      const shutdownResult = await execSimctl(shutdownCmd);

      if (shutdownResult.exitCode !== 0) {
        logger.error('Failed to shutdown simulator:', shutdownResult.stderr);
        return {
          success: false,
          error: `Failed to shutdown: ${shutdownResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info('Simulator(s) shutdown successfully');

      return {
        success: true,
        data: {
          target: all ? 'all' : simulator,
          shutdown: true,
          message: all ? 'All simulators shutdown successfully' : `Simulator "${simulator}" shutdown successfully`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in shutdown-simulator:', error);

      return {
        success: false,
        error: `Failed to shutdown simulator: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Install app on simulator tool
 * Install an app bundle on a simulator
 */
const installAppSimulator: ToolDefinition = {
  name: 'install-app-simulator',
  description: 'Install an app bundle (.app) on a simulator.',
  inputSchema: {
    type: 'object',
    properties: {
      simulator: {
        type: 'string',
        description: 'Simulator UDID or name.',
      },
      appPath: {
        type: 'string',
        description: 'Path to the .app bundle to install.',
      },
    },
    required: ['simulator', 'appPath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const simulator = args.simulator as string;
      const appPath = args.appPath as string;

      if (!simulator || !appPath) {
        return {
          success: false,
          error: 'Missing required parameters: simulator and appPath',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Installing app on simulator ${simulator}: ${appPath}`);

      const installResult = await execSimctl(['install', simulator, appPath]);

      if (installResult.exitCode !== 0) {
        logger.error('Failed to install app:', installResult.stderr);
        return {
          success: false,
          error: `Failed to install app: ${installResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`App installed successfully on simulator: ${simulator}`);

      return {
        success: true,
        data: {
          simulator,
          appPath,
          installed: true,
          message: `Successfully installed app on simulator "${simulator}"`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in install-app-simulator:', error);

      return {
        success: false,
        error: `Failed to install app: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Launch app on simulator tool
 * Launch an app on a simulator by bundle ID
 */
const launchAppSimulator: ToolDefinition = {
  name: 'launch-app-simulator',
  description: 'Launch an app on a simulator by bundle ID. Returns the process ID.',
  inputSchema: {
    type: 'object',
    properties: {
      simulator: {
        type: 'string',
        description: 'Simulator UDID or name.',
      },
      bundleId: {
        type: 'string',
        description: 'Bundle ID of the app to launch (e.g., com.example.myapp).',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional command line arguments to pass to the app.',
      },
    },
    required: ['simulator', 'bundleId'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const simulator = args.simulator as string;
      const bundleId = args.bundleId as string;
      const appArgs = (args.args as string[]) || [];

      if (!simulator || !bundleId) {
        return {
          success: false,
          error: 'Missing required parameters: simulator and bundleId',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Launching app on simulator ${simulator}: ${bundleId}`);

      const launchCmd: string[] = ['launch', simulator, bundleId, ...appArgs];
      const launchResult = await execSimctl(launchCmd);

      if (launchResult.exitCode !== 0) {
        logger.error('Failed to launch app:', launchResult.stderr);
        return {
          success: false,
          error: `Failed to launch app: ${launchResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const pid = launchResult.stdout.trim();

      logger.info(`App launched successfully on simulator: ${simulator} (PID: ${pid})`);

      return {
        success: true,
        data: {
          simulator,
          bundleId,
          pid: parseInt(pid, 10) || pid,
          args: appArgs,
          message: `Successfully launched app "${bundleId}" on simulator`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in launch-app-simulator:', error);

      return {
        success: false,
        error: `Failed to launch app: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Push notification to simulator tool
 * Send a push notification to an app on a simulator
 */
const simulatorPushNotification: ToolDefinition = {
  name: 'simulator-push-notification',
  description: 'Send a push notification to an app on a simulator.',
  inputSchema: {
    type: 'object',
    properties: {
      simulator: {
        type: 'string',
        description: 'Simulator UDID or name.',
      },
      bundleId: {
        type: 'string',
        description: 'Bundle ID of the app to receive the notification.',
      },
      title: {
        type: 'string',
        description: 'Notification title.',
      },
      body: {
        type: 'string',
        description: 'Notification body/message.',
      },
      payload: {
        type: 'object',
        description: 'Custom JSON payload for the notification.',
      },
    },
    required: ['simulator', 'bundleId'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const simulator = args.simulator as string;
      const bundleId = args.bundleId as string;
      const title = (args.title as string) || '';
      const body = (args.body as string) || '';
      const customPayload = (args.payload as Record<string, unknown>) || {};

      if (!simulator || !bundleId) {
        return {
          success: false,
          error: 'Missing required parameters: simulator and bundleId',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Sending push notification to ${bundleId} on simulator ${simulator}`);

      // Build notification payload
      const payload = {
        aps: {
          alert: {
            title: title || 'Notification',
            body: body || 'Test notification',
          },
          sound: 'default',
          badge: 1,
          'mutable-content': 1,
        },
        ...customPayload,
      };

      // Write payload to temp file
      const payloadPath = join(tmpdir(), `push-notification-${Date.now()}.json`);
      writeFileSync(payloadPath, JSON.stringify(payload));

      logger.info(`Payload file created: ${payloadPath}`);

      try {
        const pushResult = await execSimctl(['push', simulator, bundleId, payloadPath]);

        if (pushResult.exitCode !== 0) {
          logger.error('Failed to send push notification:', pushResult.stderr);
          return {
            success: false,
            error: `Failed to send push notification: ${pushResult.stderr}`,
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        logger.info('Push notification sent successfully');

        return {
          success: true,
          data: {
            simulator,
            bundleId,
            title,
            body,
            sent: true,
            message: 'Push notification sent successfully',
          },
          executionTime: Date.now() - startTime,
        };
      } finally {
        // Clean up temp file
        if (existsSync(payloadPath)) {
          unlinkSync(payloadPath);
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in simulator-push-notification:', error);

      return {
        success: false,
        error: `Failed to send push notification: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Simulator screenshot/video tool
 * Take a screenshot or record video from a simulator
 */
const simulatorScreenshot: ToolDefinition = {
  name: 'simulator-screenshot',
  description: 'Take a screenshot or record video from a simulator.',
  inputSchema: {
    type: 'object',
    properties: {
      simulator: {
        type: 'string',
        description: 'Simulator UDID or name.',
      },
      outputPath: {
        type: 'string',
        description: 'Path where to save the screenshot or video.',
      },
      type: {
        type: 'string',
        enum: ['screenshot', 'video'],
        description: 'Type of capture: "screenshot" or "video". Defaults to "screenshot".',
      },
      duration: {
        type: 'number',
        description: 'Duration in seconds for video recording. Required if type is "video".',
      },
    },
    required: ['simulator', 'outputPath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const simulator = args.simulator as string;
      const outputPath = args.outputPath as string;
      const type = (args.type as string) || 'screenshot';
      const duration = (args.duration as number) || 10;

      if (!simulator || !outputPath) {
        return {
          success: false,
          error: 'Missing required parameters: simulator and outputPath',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      if (type !== 'screenshot' && type !== 'video') {
        return {
          success: false,
          error: 'Invalid type: must be "screenshot" or "video"',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Capturing ${type} from simulator ${simulator} to ${outputPath}`);

      let captureResult: ExecResult;

      if (type === 'screenshot') {
        captureResult = await execSimctl(['io', simulator, 'screenshot', outputPath]);
      } else {
        // For video, use recordVideo command
        captureResult = await execSimctl(['io', simulator, 'recordVideo', '--duration', String(duration), outputPath]);
      }

      if (captureResult.exitCode !== 0) {
        logger.error(`Failed to capture ${type}:`, captureResult.stderr);
        return {
          success: false,
          error: `Failed to capture ${type}: ${captureResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`${type} captured successfully`);

      // For screenshots, read the file and include as base64 so Claude can see it
      let imageBase64: string | undefined;
      let imageMimeType: string | undefined;

      if (type === 'screenshot' && existsSync(outputPath)) {
        try {
          const imageBuffer = readFileSync(outputPath);
          imageBase64 = imageBuffer.toString('base64');

          const ext = extname(outputPath).toLowerCase();
          if (ext === '.png') {
            imageMimeType = 'image/png';
          } else if (ext === '.jpg' || ext === '.jpeg') {
            imageMimeType = 'image/jpeg';
          } else {
            imageMimeType = 'image/png'; // Default for simulator screenshots
          }

          logger.info(`Screenshot encoded as base64 (${imageBuffer.length} bytes)`);
        } catch (readError) {
          logger.warn('Could not read screenshot for base64 encoding:', readError);
        }
      }

      return {
        success: true,
        data: {
          simulator,
          type,
          outputPath,
          duration: type === 'video' ? duration : undefined,
          message: `${type.charAt(0).toUpperCase() + type.slice(1)} saved to ${outputPath}`,
        },
        _imageBase64: imageBase64,
        _imageMimeType: imageMimeType,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in simulator-screenshot:', error);

      return {
        success: false,
        error: `Failed to capture: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Export all simulator tools
 */
export const simulatorTools: ToolDefinition[] = [
  listSimulators,
  createSimulator,
  bootSimulator,
  shutdownSimulator,
  installAppSimulator,
  launchAppSimulator,
  simulatorPushNotification,
  simulatorScreenshot,
];

export default simulatorTools;
