import { ToolResult, ToolHandler } from '../types.js';
import { execCommand } from '../utils/exec.js';
import { logger } from '../utils/logger.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * run-swiftlint — Run SwiftLint on a project or specific files
 */
const runSwiftlint: ToolDefinition = {
  name: 'run-swiftlint',
  description: 'Run SwiftLint to check Swift code style and conventions. Returns structured violations in JSON format. Supports autocorrect mode.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the directory or file to lint (default: current directory)',
      },
      autocorrect: {
        type: 'boolean',
        description: 'Automatically fix violations where possible (default: false)',
      },
      configPath: {
        type: 'string',
        description: 'Path to .swiftlint.yml config file (optional)',
      },
      strict: {
        type: 'boolean',
        description: 'Treat warnings as errors (default: false)',
      },
      onlyRules: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only check these specific rules (optional)',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const path = args.path as string | undefined;
      const autocorrect = (args.autocorrect as boolean) || false;
      const configPath = args.configPath as string | undefined;
      const strict = (args.strict as boolean) || false;
      const onlyRules = args.onlyRules as string[] | undefined;

      logger.info(`Running SwiftLint${autocorrect ? ' (autocorrect)' : ''} on ${path || 'current directory'}`);

      // Check if swiftlint is installed
      const whichResult = await execCommand('which', ['swiftlint']);
      if (whichResult.exitCode !== 0) {
        return {
          success: false,
          error: 'SwiftLint ist nicht installiert. Installieren mit: brew install swiftlint',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const lintArgs: string[] = [];
      if (autocorrect) {
        lintArgs.push('lint', '--fix');
      } else {
        lintArgs.push('lint');
      }

      lintArgs.push('--reporter', 'json');

      if (configPath) {
        lintArgs.push('--config', configPath);
      }
      if (strict) {
        lintArgs.push('--strict');
      }
      if (path) {
        lintArgs.push('--path', path);
      }
      if (onlyRules && onlyRules.length > 0) {
        for (const rule of onlyRules) {
          lintArgs.push('--only-rule', rule);
        }
      }

      const result = await execCommand('swiftlint', lintArgs, {
        timeout: 300000, // 5 minutes for large projects
      });

      // SwiftLint returns exit code 2 for violations, which is not an error
      let violations: any[] = [];
      try {
        violations = JSON.parse(result.stdout);
      } catch {
        // If JSON parse fails, treat output as text
      }

      const errorCount = violations.filter((v: any) => v.severity === 'Error').length;
      const warningCount = violations.filter((v: any) => v.severity === 'Warning').length;

      return {
        success: true,
        data: {
          path: path || '.',
          autocorrect,
          totalViolations: violations.length,
          errors: errorCount,
          warnings: warningCount,
          violations: violations.slice(0, 200), // Limit to first 200
          summary: `${violations.length} Violations (${errorCount} Errors, ${warningCount} Warnings)`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in run-swiftlint:', error);
      return {
        success: false,
        error: `Fehler beim Ausfuehren von SwiftLint: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * run-swiftformat — Run SwiftFormat on a project or specific files
 */
const runSwiftformat: ToolDefinition = {
  name: 'run-swiftformat',
  description: 'Run SwiftFormat to format Swift code. Default is dry-run mode (lint only). Set dryRun=false to apply changes.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the directory or file to format (default: current directory)',
      },
      dryRun: {
        type: 'boolean',
        description: 'Only report changes without applying them (default: true)',
      },
      configPath: {
        type: 'string',
        description: 'Path to .swiftformat config file (optional)',
      },
      rules: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific rules to apply (optional)',
      },
      swiftVersion: {
        type: 'string',
        description: 'Swift version for format rules (e.g. "5.9")',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const path = (args.path as string) || '.';
      const dryRun = args.dryRun !== false; // default true
      const configPath = args.configPath as string | undefined;
      const rules = args.rules as string[] | undefined;
      const swiftVersion = args.swiftVersion as string | undefined;

      logger.info(`Running SwiftFormat${dryRun ? ' (dry-run)' : ''} on ${path}`);

      // Check if swiftformat is installed
      const whichResult = await execCommand('which', ['swiftformat']);
      if (whichResult.exitCode !== 0) {
        return {
          success: false,
          error: 'SwiftFormat ist nicht installiert. Installieren mit: brew install swiftformat',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const formatArgs: string[] = [path];

      if (dryRun) {
        formatArgs.push('--lint');
      }

      if (configPath) {
        formatArgs.push('--config', configPath);
      }
      if (swiftVersion) {
        formatArgs.push('--swiftversion', swiftVersion);
      }
      if (rules && rules.length > 0) {
        formatArgs.push('--rules', rules.join(','));
      }

      const result = await execCommand('swiftformat', formatArgs, {
        timeout: 300000,
      });

      const output = (result.stdout + '\n' + result.stderr).trim();
      const changedFiles = output.split('\n').filter((l) => l.includes('would have been') || l.includes('was formatted'));

      return {
        success: true,
        data: {
          path,
          dryRun,
          changedFileCount: changedFiles.length,
          changedFiles: changedFiles.slice(0, 100),
          output: output.substring(0, 10000),
          summary: dryRun
            ? `${changedFiles.length} Dateien wuerden geaendert werden`
            : `${changedFiles.length} Dateien formatiert`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in run-swiftformat:', error);
      return {
        success: false,
        error: `Fehler beim Ausfuehren von SwiftFormat: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

export const lintingTools: ToolDefinition[] = [
  runSwiftlint,
  runSwiftformat,
];

export default lintingTools;
