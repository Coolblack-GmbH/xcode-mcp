import { ToolResult, ToolHandler, ExportMethod, SigningStyle } from '../types.js';
import { execCommand, execXcode } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

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
 * Helper function to create exportOptions.plist content
 */
function createExportOptionsPlist(
  exportMethod: ExportMethod,
  signingStyle: SigningStyle = 'automatic',
  teamId?: string,
): string {
  const methodMap: Record<ExportMethod, string> = {
    'app-store': 'app-store',
    'ad-hoc': 'ad-hoc',
    enterprise: 'enterprise',
    development: 'development',
  };

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>${methodMap[exportMethod]}</string>
    <key>signingStyle</key>
    <string>${signingStyle}</string>
    <key>stripSwiftSymbols</key>
    <true/>
    <key>teamID</key>
    <string>${teamId || ''}</string>
</dict>
</plist>`;

  return plistContent;
}

/**
 * export-ipa tool
 * Export an archive to IPA file
 */
const exportIpa: ToolDefinition = {
  name: 'export-ipa',
  description: 'Export an Xcode archive to an IPA file. Creates export options plist and runs xcodebuild -exportArchive.',
  inputSchema: {
    type: 'object',
    properties: {
      archivePath: {
        type: 'string',
        description: 'Path to the .xcarchive file',
      },
      exportMethod: {
        type: 'string',
        enum: ['app-store', 'ad-hoc', 'enterprise', 'development'],
        description: 'Export method: app-store, ad-hoc, enterprise, or development',
      },
      outputPath: {
        type: 'string',
        description: 'Optional output directory path. Defaults to current directory.',
      },
      signingStyle: {
        type: 'string',
        enum: ['automatic', 'manual'],
        description: 'Signing style: automatic or manual. Defaults to automatic.',
      },
      teamId: {
        type: 'string',
        description: 'Optional Team ID for signing',
      },
    },
    required: ['archivePath', 'exportMethod'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const archivePath = args.archivePath as string;
      const exportMethod = args.exportMethod as ExportMethod;
      const outputPath = args.outputPath as string | undefined;
      const signingStyle = args.signingStyle as SigningStyle | undefined;
      const teamId = args.teamId as string | undefined;

      if (!archivePath || !exportMethod) {
        return {
          success: false,
          error: 'archivePath and exportMethod are required',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      if (!existsSync(archivePath)) {
        return {
          success: false,
          error: `Archive path not found: ${archivePath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Exporting IPA from archive: ${archivePath}`);

      // Create temporary directory for export options plist
      const tempDir = join(dirname(archivePath), '.export-options');
      try {
        const { execSync } = await import('child_process');
        execSync(`mkdir -p "${tempDir}"`);
      } catch (err) {
        logger.debug('Temp directory may already exist');
      }

      const optionsPlistPath = join(tempDir, 'exportOptions.plist');
      const plistContent = createExportOptionsPlist(exportMethod, signingStyle || 'automatic', teamId);
      writeFileSync(optionsPlistPath, plistContent);

      logger.info(`Created export options plist at: ${optionsPlistPath}`);

      // Prepare xcodebuild arguments
      const xcodebuildArgs: string[] = [
        '-exportArchive',
        '-archivePath',
        archivePath,
        '-exportPath',
        outputPath || '.',
        '-exportOptionsPlist',
        optionsPlistPath,
      ];

      logger.info(`Running xcodebuild with args: ${xcodebuildArgs.join(' ')}`);

      const result = await execXcode('xcodebuild', xcodebuildArgs);

      if (result.exitCode !== 0) {
        logger.error('Failed to export IPA:', result.stderr);
        return {
          success: false,
          error: `Failed to export IPA: ${result.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Extract app name from archive path for IPA filename
      const archiveName = archivePath.split('/').pop()?.replace('.xcarchive', '') || 'app';
      const ipaPath = join(outputPath || '.', `${archiveName}.ipa`);

      logger.info(`IPA exported successfully to: ${ipaPath}`);

      return {
        success: true,
        data: {
          exported: true,
          archivePath,
          ipaPath,
          exportMethod,
          signingStyle: signingStyle || 'automatic',
          teamId: teamId || 'none',
          message: 'IPA exported successfully',
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in export-ipa:', error);

      return {
        success: false,
        error: `Failed to export IPA: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * upload-to-appstore tool
 * Upload IPA to App Store Connect
 */
const uploadToAppStore: ToolDefinition = {
  name: 'upload-to-appstore',
  description: 'Upload an IPA file to App Store Connect for review and distribution.',
  inputSchema: {
    type: 'object',
    properties: {
      ipaPath: {
        type: 'string',
        description: 'Path to the IPA file to upload',
      },
      appleId: {
        type: 'string',
        description: 'Apple ID email address',
      },
      password: {
        type: 'string',
        description: 'App-specific password (not regular Apple ID password)',
      },
      type: {
        type: 'string',
        enum: ['ios', 'macos'],
        description: 'App type: ios or macos. Defaults to ios.',
      },
    },
    required: ['ipaPath', 'appleId', 'password'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const ipaPath = args.ipaPath as string;
      const appleId = args.appleId as string;
      const password = args.password as string;
      const type = args.type as string | undefined;

      if (!ipaPath || !appleId || !password) {
        return {
          success: false,
          error: 'ipaPath, appleId, and password are all required',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      if (!existsSync(ipaPath)) {
        return {
          success: false,
          error: `IPA file not found: ${ipaPath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Uploading IPA to App Store Connect: ${ipaPath}`);

      const appType = type || 'ios';

      const uploadResult = await execXcode('altool', [
        '--upload-app',
        '-f',
        ipaPath,
        '-t',
        appType,
        '-u',
        appleId,
        '-p',
        password,
      ]);

      if (uploadResult.exitCode !== 0) {
        logger.error('Failed to upload to App Store:', uploadResult.stderr);
        return {
          success: false,
          error: `Failed to upload to App Store: ${uploadResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Parse upload response for metadata
      const uploadIdMatch = uploadResult.stdout.match(/RequestUUID = ([a-f0-9\-]+)/i);
      const uploadId = uploadIdMatch ? uploadIdMatch[1] : 'unknown';

      logger.info(`IPA uploaded successfully with request ID: ${uploadId}`);

      return {
        success: true,
        data: {
          uploaded: true,
          ipaPath,
          requestId: uploadId,
          appType,
          destination: 'App Store Connect',
          message: 'IPA uploaded to App Store Connect for review',
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in upload-to-appstore:', error);

      return {
        success: false,
        error: `Failed to upload to App Store: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * upload-to-testflight tool
 * Upload IPA to TestFlight for beta testing
 */
const uploadToTestFlight: ToolDefinition = {
  name: 'upload-to-testflight',
  description: 'Upload an IPA file to TestFlight for beta testing and distribution to testers.',
  inputSchema: {
    type: 'object',
    properties: {
      ipaPath: {
        type: 'string',
        description: 'Path to the IPA file to upload',
      },
      appleId: {
        type: 'string',
        description: 'Apple ID email address',
      },
      password: {
        type: 'string',
        description: 'App-specific password (not regular Apple ID password)',
      },
    },
    required: ['ipaPath', 'appleId', 'password'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const ipaPath = args.ipaPath as string;
      const appleId = args.appleId as string;
      const password = args.password as string;

      if (!ipaPath || !appleId || !password) {
        return {
          success: false,
          error: 'ipaPath, appleId, and password are all required',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      if (!existsSync(ipaPath)) {
        return {
          success: false,
          error: `IPA file not found: ${ipaPath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Uploading IPA to TestFlight: ${ipaPath}`);

      // TestFlight upload uses same altool command but with different context
      const uploadResult = await execXcode('altool', [
        '--upload-app',
        '-f',
        ipaPath,
        '-t',
        'ios',
        '-u',
        appleId,
        '-p',
        password,
      ]);

      if (uploadResult.exitCode !== 0) {
        logger.error('Failed to upload to TestFlight:', uploadResult.stderr);
        return {
          success: false,
          error: `Failed to upload to TestFlight: ${uploadResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Parse upload response for metadata
      const uploadIdMatch = uploadResult.stdout.match(/RequestUUID = ([a-f0-9\-]+)/i);
      const uploadId = uploadIdMatch ? uploadIdMatch[1] : 'unknown';

      logger.info(`IPA uploaded to TestFlight successfully with request ID: ${uploadId}`);

      return {
        success: true,
        data: {
          uploaded: true,
          ipaPath,
          requestId: uploadId,
          destination: 'TestFlight',
          message: 'IPA uploaded to TestFlight for beta testing',
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in upload-to-testflight:', error);

      return {
        success: false,
        error: `Failed to upload to TestFlight: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Export all distribution tools
 */
export const distributeTools: ToolDefinition[] = [exportIpa, uploadToAppStore, uploadToTestFlight];

export default distributeTools;
