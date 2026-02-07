import { ToolResult, ToolHandler, ProfileResult } from '../types.js';
import { execCommand, execXcode, ExecResult } from '../utils/exec.js';
import { parseXcodeBuildErrors, suggestFix, ParsedError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

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
 * Profile-with-instruments tool
 * Run Instruments profiling
 */
const profileWithInstruments: ToolDefinition = {
  name: 'profile-with-instruments',
  description: 'Run Instruments profiling on an app. Use template="list" to see available templates.',
  inputSchema: {
    type: 'object',
    properties: {
      template: {
        type: 'string',
        description: 'Instruments template name (e.g., "System Trace", "Leaks", "Allocations"). Use "list" to show available templates.',
      },
      appPath: {
        type: 'string',
        description: 'Path to the app bundle to profile. Optional.',
      },
      simulator: {
        type: 'string',
        description: 'Simulator UDID or name to profile on. Optional.',
      },
      duration: {
        type: 'number',
        description: 'Profiling duration in seconds. Defaults to 10 seconds.',
      },
      outputPath: {
        type: 'string',
        description: 'Path to save the .trace file. Optional, defaults to current directory.',
      },
    },
    required: ['template'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const template = args.template as string;
      const appPath = args.appPath as string | undefined;
      const simulator = args.simulator as string | undefined;
      const duration = (args.duration as number) || 10;
      const outputPath = (args.outputPath as string) || '.';

      // List available templates
      if (template === 'list') {
        logger.info('Listing available Instruments templates');
        const result = await execCommand('xcrun', ['xctrace', 'list', 'templates']);

        if (result.exitCode !== 0) {
          logger.error('Failed to list templates:', result.stderr);
          return {
            success: false,
            error: `Failed to list templates: ${result.stderr}`,
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        // Parse template names from output
        const templates = result.stdout
          .split('\n')
          .filter((line) => line.trim() && !line.includes('Available') && !line.includes('Instruments'))
          .map((line) => line.trim());

        logger.info(`Found ${templates.length} available templates`);

        return {
          success: true,
          data: {
            templates,
            count: templates.length,
          },
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Starting Instruments profiling with template: ${template}, duration: ${duration}s`);

      const tracePath = join(outputPath, `profile-${Date.now()}.trace`);

      const cmd_args: string[] = ['xctrace', 'record', '--template', template, '--output', tracePath, '--time-limit', duration.toString()];

      if (appPath) {
        cmd_args.push('--app-path', appPath);
      }

      if (simulator) {
        cmd_args.push('--device', simulator);
      }

      const result = await execCommand('xcrun', cmd_args, {
        timeout: (duration + 30) * 1000, // Add 30 seconds buffer
      });

      if (result.exitCode !== 0) {
        logger.error('Instruments profiling failed:', result.stderr);
        return {
          success: false,
          error: `Instruments profiling failed: ${result.stderr}`,
          data: {
            template,
            duration,
          },
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Instruments profiling completed. Trace saved to: ${tracePath}`);

      return {
        success: true,
        data: {
          tracePath,
          template,
          duration,
          summary: `Profiled with ${template} template for ${duration} seconds`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in profile-with-instruments:', error);

      return {
        success: false,
        error: `Failed to profile with instruments: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Memory-profile tool
 * Profile memory usage
 */
const memoryProfile: ToolDefinition = {
  name: 'memory-profile',
  description: 'Profile memory usage of an app on a simulator using Leaks or Allocations template.',
  inputSchema: {
    type: 'object',
    properties: {
      simulator: {
        type: 'string',
        description: 'Simulator UDID or name to profile on.',
      },
      bundleId: {
        type: 'string',
        description: 'Bundle ID of the app to profile.',
      },
      duration: {
        type: 'number',
        description: 'Profiling duration in seconds. Defaults to 10 seconds.',
      },
    },
    required: ['simulator', 'bundleId'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const simulator = args.simulator as string;
      const bundleId = args.bundleId as string;
      const duration = (args.duration as number) || 10;

      logger.info(`Profiling memory for bundle: ${bundleId} on simulator: ${simulator}`);

      const tracePath = `memory-profile-${Date.now()}.trace`;

      const result = await execCommand('xcrun', [
        'xctrace',
        'record',
        '--template',
        'Leaks',
        '--device',
        simulator,
        '--app-bundle-id',
        bundleId,
        '--output',
        tracePath,
        '--time-limit',
        duration.toString(),
      ]);

      if (result.exitCode !== 0) {
        logger.error('Memory profiling failed:', result.stderr);
        return {
          success: false,
          error: `Memory profiling failed: ${result.stderr}`,
          data: {
            simulator,
            bundleId,
            duration,
          },
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Memory profiling completed. Trace saved to: ${tracePath}`);

      return {
        success: true,
        data: {
          tracePath,
          simulator,
          bundleId,
          duration,
          summary: `Memory profile captured for ${bundleId}`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in memory-profile:', error);

      return {
        success: false,
        error: `Failed to profile memory: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Parse-build-logs tool
 * Parse xcodebuild output
 */
const parseBuildLogs: ToolDefinition = {
  name: 'parse-build-logs',
  description: 'Parse xcodebuild output or log file to extract structured errors with fix suggestions.',
  inputSchema: {
    type: 'object',
    properties: {
      logContent: {
        type: 'string',
        description: 'Raw build log content to parse. Either this or logFile is required.',
      },
      logFile: {
        type: 'string',
        description: 'Path to build log file to parse. Either this or logContent is required.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const logContent = args.logContent as string | undefined;
      const logFile = args.logFile as string | undefined;

      let content = logContent;

      if (!content && logFile) {
        logger.info(`Reading log file: ${logFile}`);
        if (!existsSync(logFile)) {
          return {
            success: false,
            error: `Log file not found: ${logFile}`,
            data: null,
            executionTime: Date.now() - startTime,
          };
        }
        content = readFileSync(logFile, 'utf-8');
      }

      if (!content) {
        return {
          success: false,
          error: 'Either logContent or logFile must be provided',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info('Parsing build logs for errors');

      const parsedErrors = parseXcodeBuildErrors(content);

      logger.info(`Found ${parsedErrors.length} errors`);

      return {
        success: true,
        data: {
          errorCount: parsedErrors.length,
          errors: parsedErrors,
          summary: `Parsed ${parsedErrors.length} build errors`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in parse-build-logs:', error);

      return {
        success: false,
        error: `Failed to parse build logs: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Suggest-build-fixes tool
 * Suggest fixes for build errors
 */
const suggestBuildFixes: ToolDefinition = {
  name: 'suggest-build-fixes',
  description: 'Suggest fixes for a specific build error message with documentation links.',
  inputSchema: {
    type: 'object',
    properties: {
      errorMessage: {
        type: 'string',
        description: 'The build error message to get suggestions for.',
      },
    },
    required: ['errorMessage'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const errorMessage = args.errorMessage as string;

      logger.info('Suggesting fixes for error');

      // Parse the error message to understand its type
      const parsedErrors = parseXcodeBuildErrors(errorMessage);

      if (parsedErrors.length === 0) {
        logger.warn('No errors could be parsed from message');
        return {
          success: false,
          error: 'Could not parse error from message',
          data: {
            errorMessage,
          },
          executionTime: Date.now() - startTime,
        };
      }

      const error = parsedErrors[0];
      const suggestions = suggestFix(error);

      logger.info(`Generated ${suggestions.length} suggestions for ${error.type}`);

      // Add documentation links based on error type
      const documentationLinks: Record<string, string> = {
        CODE_SIGNING: 'https://developer.apple.com/help/xcode/code-signing/',
        MISSING_FRAMEWORK: 'https://developer.apple.com/documentation/xcode/linking-frameworks-with-your-app',
        MISSING_PROFILE: 'https://developer.apple.com/help/xcode/create-provisioning-profiles/',
        SWIFT_COMPILATION: 'https://developer.apple.com/swift/',
        LINKER: 'https://developer.apple.com/documentation/xcode/setting-the-ld-flags-and-framework-linker-flags',
        MISSING_RUNTIME: 'https://developer.apple.com/download/all/',
        GENERIC: 'https://developer.apple.com/help/xcode/',
      };

      return {
        success: true,
        data: {
          errorType: error.type,
          errorMessage: error.message,
          suggestions,
          documentation: documentationLinks[error.type] || documentationLinks.GENERIC,
          file: error.file,
          line: error.line,
          column: error.column,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in suggest-build-fixes:', error);

      return {
        success: false,
        error: `Failed to suggest fixes: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Export-build-log tool
 * Export build logs
 */
const exportBuildLog: ToolDefinition = {
  name: 'export-build-log',
  description: 'Export build logs in JSON or text format.',
  inputSchema: {
    type: 'object',
    properties: {
      logFile: {
        type: 'string',
        description: 'Path to the build log file to export.',
      },
      format: {
        type: 'string',
        enum: ['json', 'text'],
        description: 'Export format. Defaults to text.',
      },
      outputPath: {
        type: 'string',
        description: 'Path where to save the exported log. If not provided, returns content in response.',
      },
    },
    required: ['logFile'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const logFile = args.logFile as string;
      const format = (args.format as string) || 'text';
      const outputPath = args.outputPath as string | undefined;

      logger.info(`Exporting build log: ${logFile} as ${format}`);

      if (!existsSync(logFile)) {
        return {
          success: false,
          error: `Log file not found: ${logFile}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const logContent = readFileSync(logFile, 'utf-8');

      let exportedContent: string;
      let finalOutputPath: string | undefined;

      if (format === 'json') {
        // Parse errors and structure as JSON
        const parsedErrors = parseXcodeBuildErrors(logContent);
        const jsonData = {
          timestamp: new Date().toISOString(),
          logFile,
          errorCount: parsedErrors.length,
          content: logContent,
          errors: parsedErrors,
        };

        exportedContent = JSON.stringify(jsonData, null, 2);

        if (outputPath) {
          const ext = outputPath.endsWith('.json') ? '' : '.json';
          finalOutputPath = `${outputPath}${ext}`;
          writeFileSync(finalOutputPath, exportedContent, 'utf-8');
          logger.info(`Exported JSON log to: ${finalOutputPath}`);
        }
      } else {
        exportedContent = logContent;

        if (outputPath) {
          writeFileSync(outputPath, exportedContent, 'utf-8');
          finalOutputPath = outputPath;
          logger.info(`Exported text log to: ${finalOutputPath}`);
        }
      }

      return {
        success: true,
        data: {
          logFile,
          format,
          outputPath: finalOutputPath,
          contentSize: exportedContent.length,
          contentPreview: exportedContent.substring(0, 500),
          message: finalOutputPath ? `Successfully exported to ${finalOutputPath}` : 'Log content returned in response',
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in export-build-log:', error);

      return {
        success: false,
        error: `Failed to export build log: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Export all profiling tools
 */
export const profilingTools: ToolDefinition[] = [
  profileWithInstruments,
  memoryProfile,
  parseBuildLogs,
  suggestBuildFixes,
  exportBuildLog,
];

export default profilingTools;
