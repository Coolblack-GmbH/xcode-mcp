import { ToolResult, ToolHandler } from '../types.js';
import { execCommand, execXcode } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { findProjectPath } from '../utils/paths.js';
import { dirname } from 'path';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * get-version-info — Read marketing version and build number from the project
 */
const getVersionInfo: ToolDefinition = {
  name: 'get-version-info',
  description: 'Get the current marketing version (CFBundleShortVersionString) and build number (CFBundleVersion) of the project.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to .xcodeproj or .xcworkspace. Defaults to auto-detected project.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      let projectPath = args.projectPath as string | undefined;

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

      const projectDir = dirname(projectPath);
      logger.info(`Getting version info for: ${projectPath}`);

      // Try agvtool first
      const marketingResult = await execXcode('xcrun', ['agvtool', 'what-marketing-version'], {
        cwd: projectDir,
      });
      const buildResult = await execXcode('xcrun', ['agvtool', 'what-version'], {
        cwd: projectDir,
      });

      let marketingVersion: string | null = null;
      let buildNumber: string | null = null;

      if (marketingResult.exitCode === 0) {
        const match = marketingResult.stdout.match(/(\d+\.\d+(?:\.\d+)?)/);
        if (match) marketingVersion = match[1];
      }

      if (buildResult.exitCode === 0) {
        const match = buildResult.stdout.match(/Current version of project .+ is:\s*(\S+)/);
        if (match) buildNumber = match[1];
      }

      // Fallback: xcodebuild -showBuildSettings
      if (!marketingVersion || !buildNumber) {
        const projectType = projectPath.endsWith('.xcworkspace') ? 'workspace' : 'project';
        const settingsResult = await execXcode('xcodebuild', [
          `-${projectType}`, projectPath,
          '-showBuildSettings',
        ]);

        if (settingsResult.exitCode === 0) {
          if (!marketingVersion) {
            const mvMatch = settingsResult.stdout.match(/MARKETING_VERSION\s*=\s*(\S+)/);
            if (mvMatch) marketingVersion = mvMatch[1];
          }
          if (!buildNumber) {
            const bnMatch = settingsResult.stdout.match(/CURRENT_PROJECT_VERSION\s*=\s*(\S+)/);
            if (bnMatch) buildNumber = bnMatch[1];
          }
        }
      }

      return {
        success: true,
        data: {
          projectPath,
          marketingVersion: marketingVersion || 'unknown',
          buildNumber: buildNumber || 'unknown',
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in get-version-info:', error);
      return {
        success: false,
        error: `Fehler beim Lesen der Versionsinformationen: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * bump-version — Increment or set the marketing version and/or build number
 */
const bumpVersion: ToolDefinition = {
  name: 'bump-version',
  description: 'Increment or set the marketing version (major/minor/patch) and/or build number of the project.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to .xcodeproj or .xcworkspace. Defaults to auto-detected project.',
      },
      bumpType: {
        type: 'string',
        enum: ['major', 'minor', 'patch', 'build'],
        description: 'What to increment: major (1.0.0→2.0.0), minor (1.0.0→1.1.0), patch (1.0.0→1.0.1), or build (build number +1)',
      },
      setVersion: {
        type: 'string',
        description: 'Explicit marketing version to set (e.g. "2.1.0"). Overrides bumpType for marketing version.',
      },
      setBuild: {
        type: 'string',
        description: 'Explicit build number to set (e.g. "42"). Overrides bumpType for build number.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      let projectPath = args.projectPath as string | undefined;
      const bumpType = args.bumpType as string | undefined;
      const setVersion = args.setVersion as string | undefined;
      const setBuild = args.setBuild as string | undefined;

      if (!bumpType && !setVersion && !setBuild) {
        return {
          success: false,
          error: 'Bitte bumpType, setVersion oder setBuild angeben.',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

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

      const projectDir = dirname(projectPath);
      logger.info(`Bumping version for: ${projectPath}`);

      let newMarketingVersion: string | undefined;
      let newBuildNumber: string | undefined;

      // Handle marketing version
      if (setVersion) {
        newMarketingVersion = setVersion;
      } else if (bumpType && bumpType !== 'build') {
        // Read current version first
        const currentResult = await execXcode('xcrun', ['agvtool', 'what-marketing-version'], {
          cwd: projectDir,
        });
        let currentVersion = '1.0.0';
        if (currentResult.exitCode === 0) {
          const match = currentResult.stdout.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
          if (match) {
            const major = parseInt(match[1]);
            const minor = parseInt(match[2]);
            const patchNum = parseInt(match[3] || '0');

            switch (bumpType) {
              case 'major':
                newMarketingVersion = `${major + 1}.0.0`;
                break;
              case 'minor':
                newMarketingVersion = `${major}.${minor + 1}.0`;
                break;
              case 'patch':
                newMarketingVersion = `${major}.${minor}.${patchNum + 1}`;
                break;
            }
          }
        }
        if (!newMarketingVersion) {
          newMarketingVersion = '1.0.0';
        }
      }

      // Set marketing version via agvtool
      if (newMarketingVersion) {
        const mvResult = await execXcode('xcrun', ['agvtool', 'new-marketing-version', newMarketingVersion], {
          cwd: projectDir,
        });
        if (mvResult.exitCode !== 0) {
          // Fallback: PlistBuddy
          logger.warn('agvtool fehlgeschlagen, versuche PlistBuddy-Fallback');
          const plistResult = await execCommand('/usr/libexec/PlistBuddy', [
            '-c', `Set :CFBundleShortVersionString ${newMarketingVersion}`,
            `${projectDir}/Info.plist`,
          ]);
          if (plistResult.exitCode !== 0) {
            return {
              success: false,
              error: `Konnte Marketing-Version nicht setzen: ${mvResult.stderr}`,
              data: null,
              executionTime: Date.now() - startTime,
            };
          }
        }
      }

      // Handle build number
      if (setBuild) {
        newBuildNumber = setBuild;
        const bnResult = await execXcode('xcrun', ['agvtool', 'new-version', '-all', setBuild], {
          cwd: projectDir,
        });
        if (bnResult.exitCode !== 0) {
          // Fallback: PlistBuddy
          await execCommand('/usr/libexec/PlistBuddy', [
            '-c', `Set :CFBundleVersion ${setBuild}`,
            `${projectDir}/Info.plist`,
          ]);
        }
      } else if (bumpType === 'build') {
        const nextResult = await execXcode('xcrun', ['agvtool', 'next-version', '-all'], {
          cwd: projectDir,
        });
        if (nextResult.exitCode === 0) {
          const match = nextResult.stdout.match(/Updated .+ to (\S+)/);
          if (match) newBuildNumber = match[1];
        }
      }

      return {
        success: true,
        data: {
          projectPath,
          marketingVersion: newMarketingVersion || 'unchanged',
          buildNumber: newBuildNumber || 'unchanged',
          bumpType: bumpType || 'explicit',
          message: `Version erfolgreich aktualisiert`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in bump-version:', error);
      return {
        success: false,
        error: `Fehler beim Aktualisieren der Version: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

export const versioningTools: ToolDefinition[] = [
  getVersionInfo,
  bumpVersion,
];

export default versioningTools;
