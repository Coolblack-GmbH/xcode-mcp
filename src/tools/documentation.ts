import { ToolResult, ToolHandler } from '../types.js';
import { execXcode } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { findProjectPath } from '../utils/paths.js';
import { existsSync } from 'fs';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * build-documentation — Build DocC documentation from source
 */
const buildDocumentation: ToolDefinition = {
  name: 'build-documentation',
  description: 'Build DocC documentation for a framework or Swift Package using xcodebuild docbuild. Generates a .doccarchive that can be hosted or viewed in Xcode.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to .xcodeproj, .xcworkspace, or Swift Package directory. Defaults to auto-detected project.',
      },
      scheme: {
        type: 'string',
        description: 'Build scheme (required for Xcode projects, optional for Swift Packages)',
      },
      outputPath: {
        type: 'string',
        description: 'Directory for the generated .doccarchive output',
      },
      platform: {
        type: 'string',
        enum: ['iOS', 'macOS', 'watchOS', 'tvOS', 'visionOS'],
        description: 'Target platform (default: macOS for frameworks, iOS for apps)',
      },
      hostingBasePath: {
        type: 'string',
        description: 'Base path for static hosting (e.g. "/my-framework" for GitHub Pages)',
      },
      exportStaticHTML: {
        type: 'boolean',
        description: 'Convert .doccarchive to static HTML for web hosting (default: false)',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      let projectPath = args.projectPath as string | undefined;
      const scheme = args.scheme as string | undefined;
      const outputPath = args.outputPath as string | undefined;
      const platform = args.platform as string | undefined;
      const hostingBasePath = args.hostingBasePath as string | undefined;
      const exportStaticHTML = (args.exportStaticHTML as boolean) || false;

      // Auto-detect project
      if (!projectPath) {
        const detected = await findProjectPath();
        if (!detected) {
          return {
            success: false,
            error: 'Kein Xcode-Projekt gefunden. Bitte projectPath angeben.',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }
        projectPath = detected;
      }

      logger.info(`Building documentation for: ${projectPath}`);

      // Determine if this is a Swift Package or Xcode project
      const isSwiftPackage = existsSync(`${projectPath}/Package.swift`) ||
        projectPath.endsWith('Package.swift');

      const buildArgs: string[] = ['docbuild'];

      if (isSwiftPackage) {
        // For Swift Packages, use -scheme if provided
        if (scheme) {
          buildArgs.push('-scheme', scheme);
        }
      } else {
        // For Xcode projects
        const projectType = projectPath.endsWith('.xcworkspace') ? 'workspace' : 'project';
        buildArgs.push(`-${projectType}`, projectPath);

        if (scheme) {
          buildArgs.push('-scheme', scheme);
        }
      }

      // Platform-specific destination
      if (platform) {
        const destinationMap: Record<string, string> = {
          iOS: 'generic/platform=iOS',
          macOS: 'generic/platform=macOS',
          watchOS: 'generic/platform=watchOS',
          tvOS: 'generic/platform=tvOS',
          visionOS: 'generic/platform=visionOS',
        };
        const dest = destinationMap[platform] || `generic/platform=${platform}`;
        buildArgs.push('-destination', dest);
      }

      if (outputPath) {
        buildArgs.push('-derivedDataPath', outputPath);
      }

      // Add hosting base path for web deployment
      if (hostingBasePath) {
        buildArgs.push(
          'OTHER_DOCC_FLAGS=--hosting-base-path ' + hostingBasePath,
        );
      }

      const result = await execXcode('xcodebuild', buildArgs, {
        cwd: isSwiftPackage ? projectPath : undefined,
      });

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: `DocC Build fehlgeschlagen: ${result.stderr.substring(0, 1000)}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Find the generated .doccarchive
      let doccarchivePath: string | undefined;
      const archiveMatch = result.stdout.match(/(\S+\.doccarchive)/);
      if (archiveMatch) {
        doccarchivePath = archiveMatch[1];
      }

      // Export to static HTML if requested
      let htmlOutputPath: string | undefined;
      if (exportStaticHTML && doccarchivePath && existsSync(doccarchivePath)) {
        const htmlDir = outputPath
          ? `${outputPath}/docs`
          : `${projectPath}/docs`;

        const convertResult = await execXcode('xcrun', [
          'docc', 'process-archive', 'transform-for-static-hosting',
          doccarchivePath,
          '--output-path', htmlDir,
          ...(hostingBasePath ? ['--hosting-base-path', hostingBasePath] : []),
        ]);

        if (convertResult.exitCode === 0) {
          htmlOutputPath = htmlDir;
        }
      }

      return {
        success: true,
        data: {
          projectPath,
          scheme: scheme || 'auto',
          doccarchivePath,
          htmlOutputPath,
          isSwiftPackage,
          message: 'Dokumentation erfolgreich erstellt',
          output: result.stdout.substring(0, 3000),
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in build-documentation:', error);
      return {
        success: false,
        error: `Fehler beim Erstellen der Dokumentation: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

export const documentationTools: ToolDefinition[] = [
  buildDocumentation,
];

export default documentationTools;
