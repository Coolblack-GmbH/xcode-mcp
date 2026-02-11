import { ToolResult, ToolHandler } from '../types.js';
import { execCommand, execShell } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * symbolicate-crash-log — Symbolicate a crash log using dSYM files
 */
const symbolicateCrashLog: ToolDefinition = {
  name: 'symbolicate-crash-log',
  description: 'Symbolicate a crash log (.crash/.ips) using dSYM bundles. Auto-finds dSYMs via Spotlight or accepts explicit path.',
  inputSchema: {
    type: 'object',
    properties: {
      crashLogPath: {
        type: 'string',
        description: 'Path to the .crash or .ips crash log file',
      },
      dsymPath: {
        type: 'string',
        description: 'Path to the .dSYM bundle. If not provided, will search via Spotlight (mdfind).',
      },
      address: {
        type: 'string',
        description: 'Specific memory address to symbolicate (for use with atos)',
      },
      loadAddress: {
        type: 'string',
        description: 'Load address of the binary (for atos, e.g. "0x100000000")',
      },
      architecture: {
        type: 'string',
        enum: ['arm64', 'arm64e', 'x86_64'],
        description: 'Architecture of the binary (default: arm64)',
      },
    },
    required: ['crashLogPath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const crashLogPath = args.crashLogPath as string;
      let dsymPath = args.dsymPath as string | undefined;
      const address = args.address as string | undefined;
      const loadAddress = args.loadAddress as string | undefined;
      const architecture = (args.architecture as string) || 'arm64';

      if (!existsSync(crashLogPath)) {
        return {
          success: false,
          error: `Crash-Log nicht gefunden: ${crashLogPath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Symbolicating crash log: ${crashLogPath}`);

      // If using atos for a specific address
      if (address && dsymPath) {
        const atosArgs = [
          'atos',
          '-arch', architecture,
          '-o', dsymPath,
        ];
        if (loadAddress) {
          atosArgs.push('-l', loadAddress);
        }
        atosArgs.push(address);

        const atosResult = await execCommand('xcrun', atosArgs);
        return {
          success: atosResult.exitCode === 0,
          data: {
            method: 'atos',
            address,
            symbolicated: atosResult.stdout.trim(),
          },
          error: atosResult.exitCode !== 0 ? atosResult.stderr : undefined,
          executionTime: Date.now() - startTime,
        };
      }

      // Read crash log to extract bundle identifier for dSYM lookup
      const crashContent = readFileSync(crashLogPath, 'utf-8');
      let bundleId: string | undefined;

      // Try to extract bundle ID from crash log
      const bundleMatch = crashContent.match(/(?:Identifier|CFBundleIdentifier):\s*(\S+)/);
      if (bundleMatch) {
        bundleId = bundleMatch[1];
      }

      // Find dSYM via Spotlight if not provided
      if (!dsymPath && bundleId) {
        const mdfindResult = await execCommand('mdfind', [
          `com_apple_xcode_dsym_uuids == * && kMDItemDisplayName == "*.dSYM"`,
        ]);
        if (mdfindResult.exitCode === 0 && mdfindResult.stdout.trim()) {
          const dsyms = mdfindResult.stdout.trim().split('\n');
          dsymPath = dsyms[0]; // Use the first match
        }
      }

      // Try symbolicatecrash script
      const xcodePathResult = await execCommand('xcode-select', ['-p']);
      const xcodePath = xcodePathResult.stdout.trim();
      const symbolicateScript = `${xcodePath}/Platforms/iPhoneOS.platform/Developer/Library/PrivateFrameworks/DTDeviceKitBase.framework/Versions/A/Resources/symbolicatecrash`;
      const altScript = `${xcodePath}/../SharedFrameworks/DVTFoundation.framework/Versions/A/Resources/symbolicatecrash`;

      let scriptPath: string | undefined;
      if (existsSync(symbolicateScript)) {
        scriptPath = symbolicateScript;
      } else if (existsSync(altScript)) {
        scriptPath = altScript;
      }

      if (scriptPath) {
        const env = { ...process.env, DEVELOPER_DIR: xcodePath };
        const symArgs = [scriptPath, crashLogPath];
        if (dsymPath) {
          symArgs.push('-d', dsymPath);
        }

        const symResult = await execShell(`DEVELOPER_DIR="${xcodePath}" "${scriptPath}" "${crashLogPath}"${dsymPath ? ` -d "${dsymPath}"` : ''}`, {
          timeout: 120000,
        });

        if (symResult.exitCode === 0) {
          return {
            success: true,
            data: {
              method: 'symbolicatecrash',
              crashLogPath,
              dsymPath,
              symbolicated: symResult.stdout.substring(0, 50000),
            },
            executionTime: Date.now() - startTime,
          };
        }
      }

      // Fallback: return raw crash log with metadata
      return {
        success: true,
        data: {
          method: 'raw',
          crashLogPath,
          dsymPath: dsymPath || 'not found',
          bundleId,
          note: 'Konnte nicht symbolisieren. Crash-Log-Inhalt wird roh zurueckgegeben.',
          content: crashContent.substring(0, 50000),
        },
        warnings: ['Symbolisierung nicht moeglich - dSYM oder symbolicatecrash nicht gefunden'],
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in symbolicate-crash-log:', error);
      return {
        success: false,
        error: `Fehler bei der Symbolisierung: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * read-crash-reports — Scan and read crash reports from DiagnosticReports
 */
const readCrashReports: ToolDefinition = {
  name: 'read-crash-reports',
  description: 'Scan ~/Library/Logs/DiagnosticReports/ for crash reports (.crash/.ips). Optionally filter by app name.',
  inputSchema: {
    type: 'object',
    properties: {
      appName: {
        type: 'string',
        description: 'Filter crash reports by application name (optional)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of crash reports to return (default: 10)',
      },
      readContent: {
        type: 'boolean',
        description: 'Include the full content of crash reports (default: false, only lists metadata)',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const appName = args.appName as string | undefined;
      const limit = (args.limit as number) || 10;
      const readContent = (args.readContent as boolean) || false;

      const diagnosticDirs = [
        join(homedir(), 'Library/Logs/DiagnosticReports'),
        join(homedir(), 'Library/Logs/DiagnosticReports/Retired'),
      ];

      logger.info(`Scanning crash reports${appName ? ` for ${appName}` : ''}`);

      const reports: Array<{
        fileName: string;
        path: string;
        appName: string;
        date: string;
        size: number;
        content?: string;
      }> = [];

      for (const dir of diagnosticDirs) {
        if (!existsSync(dir)) continue;

        const files = readdirSync(dir).filter(
          (f) => f.endsWith('.crash') || f.endsWith('.ips') || f.endsWith('.diag'),
        );

        for (const file of files) {
          const filePath = join(dir, file);
          const stat = statSync(filePath);

          // Extract app name from filename (format: AppName-YYYY-MM-DD-HHMMSS.crash)
          const nameMatch = file.match(/^(.+?)-\d{4}-\d{2}-\d{2}/);
          const fileAppName = nameMatch ? nameMatch[1] : file;

          if (appName && !fileAppName.toLowerCase().includes(appName.toLowerCase())) {
            continue;
          }

          const report: any = {
            fileName: file,
            path: filePath,
            appName: fileAppName,
            date: stat.mtime.toISOString(),
            size: stat.size,
          };

          if (readContent) {
            try {
              const content = readFileSync(filePath, 'utf-8');
              report.content = content.substring(0, 20000);
            } catch {
              report.content = 'Konnte Datei nicht lesen';
            }
          }

          reports.push(report);
        }
      }

      // Sort by date, newest first
      reports.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // Apply limit
      const limitedReports = reports.slice(0, limit);

      return {
        success: true,
        data: {
          totalFound: reports.length,
          returned: limitedReports.length,
          filter: appName || 'all',
          reports: limitedReports,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in read-crash-reports:', error);
      return {
        success: false,
        error: `Fehler beim Lesen der Crash-Reports: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

export const crashTools: ToolDefinition[] = [
  symbolicateCrashLog,
  readCrashReports,
];

export default crashTools;
