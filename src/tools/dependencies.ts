import { ToolResult, ToolHandler, Dependency } from '../types.js';
import { execCommand, execXcode, ExecResult } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { existsSync, readFileSync } from 'fs';
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
 * Pod-install tool
 * Install CocoaPods dependencies
 */
const podInstall: ToolDefinition = {
  name: 'pod-install',
  description: 'Install CocoaPods dependencies. Optionally updates pod repository specs.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to the project directory containing Podfile (optional, defaults to current directory)',
      },
      repoUpdate: {
        type: 'boolean',
        description: 'If true, updates pod repository specs before installing. Defaults to false.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const projectPath = (args.projectPath as string) || '.';
      const repoUpdate = (args.repoUpdate as boolean) || false;

      logger.info(`Running pod install in: ${projectPath}`);

      const podfileCheck = existsSync(join(projectPath, 'Podfile'));
      if (!podfileCheck) {
        logger.warn(`Podfile not found in ${projectPath}`);
        return {
          success: false,
          error: `Podfile not found in ${projectPath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const args_cmd: string[] = ['install'];
      if (repoUpdate) {
        args_cmd.push('--repo-update');
        logger.info('Adding --repo-update flag to pod install');
      }

      const result = await execCommand('pod', args_cmd, {
        cwd: projectPath,
        timeout: 600000, // 10 minutes
      });

      if (result.exitCode !== 0) {
        logger.error('Pod install failed:', result.stderr);
        return {
          success: false,
          error: `Pod install failed: ${result.stderr}`,
          data: {
            projectPath,
            repoUpdate,
            stdout: result.stdout,
          },
          executionTime: Date.now() - startTime,
        };
      }

      // Parse output for installed pods
      const podLockPath = join(projectPath, 'Podfile.lock');
      const installedPods: string[] = [];

      if (existsSync(podLockPath)) {
        try {
          const lockContent = readFileSync(podLockPath, 'utf-8');
          const podMatches = lockContent.match(/^  - ([^\s(]+)/gm);
          if (podMatches) {
            podMatches.forEach((match) => {
              const podName = match.replace('  - ', '').split(' ')[0];
              installedPods.push(podName);
            });
          }
        } catch (e) {
          logger.warn('Could not parse Podfile.lock');
        }
      }

      logger.info(`Pod install completed successfully. Installed ${installedPods.length} pods`);

      return {
        success: true,
        data: {
          projectPath,
          installed: true,
          installedPods,
          podsCount: installedPods.length,
          message: `Successfully installed ${installedPods.length} pods`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in pod-install:', error);

      return {
        success: false,
        error: `Failed to run pod install: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Pod-update tool
 * Update specific/all pods
 */
const podUpdate: ToolDefinition = {
  name: 'pod-update',
  description: 'Update specific pods or all pods if no pod name is specified.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to the project directory containing Podfile (optional)',
      },
      podName: {
        type: 'string',
        description: 'Specific pod name to update. If not provided, updates all pods.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const projectPath = (args.projectPath as string) || '.';
      const podName = args.podName as string | undefined;

      logger.info(`Running pod update in: ${projectPath}${podName ? ` for pod: ${podName}` : ''}`);

      const podfileCheck = existsSync(join(projectPath, 'Podfile'));
      if (!podfileCheck) {
        logger.warn(`Podfile not found in ${projectPath}`);
        return {
          success: false,
          error: `Podfile not found in ${projectPath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const cmd_args: string[] = ['update'];
      if (podName) {
        cmd_args.push(podName);
      }

      const result = await execCommand('pod', cmd_args, {
        cwd: projectPath,
        timeout: 600000, // 10 minutes
      });

      if (result.exitCode !== 0) {
        logger.error('Pod update failed:', result.stderr);
        return {
          success: false,
          error: `Pod update failed: ${result.stderr}`,
          data: {
            projectPath,
            podName: podName || 'all',
          },
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Pod update completed successfully${podName ? ` for ${podName}` : ''}`);

      return {
        success: true,
        data: {
          projectPath,
          updated: true,
          podName: podName || 'all',
          message: `Successfully updated ${podName || 'all pods'}`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in pod-update:', error);

      return {
        success: false,
        error: `Failed to run pod update: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * SPM-add-package tool
 * Add Swift Package dependency
 */
const spmAddPackage: ToolDefinition = {
  name: 'spm-add-package',
  description: 'Add a Swift Package dependency to the project.',
  inputSchema: {
    type: 'object',
    properties: {
      packageUrl: {
        type: 'string',
        description: 'URL of the Swift Package (e.g., https://github.com/user/repo.git)',
      },
      version: {
        type: 'string',
        description: 'Version requirement (e.g., 1.0.0 or 1.0.0..<2.0.0). Optional.',
      },
      branch: {
        type: 'string',
        description: 'Branch name to use. Optional, alternative to version.',
      },
      projectPath: {
        type: 'string',
        description: 'Path to the project directory. Optional, defaults to current directory.',
      },
    },
    required: ['packageUrl'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const packageUrl = args.packageUrl as string;
      const version = args.version as string | undefined;
      const branch = args.branch as string | undefined;
      const projectPath = (args.projectPath as string) || '.';

      logger.info(`Adding SPM package: ${packageUrl}${version ? ` at version ${version}` : ''}${branch ? ` at branch ${branch}` : ''}`);

      // Check for Package.swift
      const packageSwiftPath = join(projectPath, 'Package.swift');
      const xcodeProjectPath = projectPath; // For xcodebuild approach

      let result: ExecResult;

      // Try using swift package resolve first for standalone packages
      if (existsSync(packageSwiftPath)) {
        logger.info('Package.swift found, using swift package resolve');
        result = await execCommand('swift', ['package', 'resolve'], {
          cwd: projectPath,
          timeout: 300000,
        });
      } else {
        // For Xcode projects, use xcodebuild to add the package
        logger.info('Using xcodebuild to add package dependency');

        const versionArg = version ? `-exact ${version}` : branch ? `-branch ${branch}` : '';

        result = await execCommand('xcodebuild', ['-addPackageDependency', packageUrl, versionArg].filter((x) => x), {
          cwd: xcodeProjectPath,
          timeout: 300000,
        });
      }

      if (result.exitCode !== 0) {
        logger.error('Failed to add SPM package:', result.stderr);
        return {
          success: false,
          error: `Failed to add SPM package: ${result.stderr}`,
          data: {
            packageUrl,
            version,
            branch,
          },
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`SPM package added successfully: ${packageUrl}`);

      return {
        success: true,
        data: {
          added: true,
          packageUrl,
          version: version || 'latest',
          branch: branch || 'main',
          message: `Successfully added package: ${packageUrl}`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in spm-add-package:', error);

      return {
        success: false,
        error: `Failed to add SPM package: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * SPM-resolve tool
 * Resolve SPM dependencies
 */
const spmResolve: ToolDefinition = {
  name: 'spm-resolve',
  description: 'Resolve Swift Package Manager dependencies.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to the project directory. Optional, defaults to current directory.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const projectPath = (args.projectPath as string) || '.';

      logger.info(`Resolving SPM dependencies in: ${projectPath}`);

      const packageSwiftPath = join(projectPath, 'Package.swift');
      if (!existsSync(packageSwiftPath)) {
        logger.warn(`Package.swift not found in ${projectPath}`);
        return {
          success: false,
          error: `Package.swift not found in ${projectPath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const result = await execCommand('swift', ['package', 'resolve'], {
        cwd: projectPath,
        timeout: 300000,
      });

      if (result.exitCode !== 0) {
        logger.error('SPM resolve failed:', result.stderr);
        return {
          success: false,
          error: `SPM resolve failed: ${result.stderr}`,
          data: {
            projectPath,
          },
          executionTime: Date.now() - startTime,
        };
      }

      logger.info('SPM dependencies resolved successfully');

      return {
        success: true,
        data: {
          projectPath,
          resolved: true,
          message: 'SPM dependencies resolved successfully',
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in spm-resolve:', error);

      return {
        success: false,
        error: `Failed to resolve SPM dependencies: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * List-dependencies tool
 * List all dependencies (Pods + SPM)
 */
const listDependencies: ToolDefinition = {
  name: 'list-dependencies',
  description: 'List all project dependencies from both CocoaPods (Podfile.lock) and Swift Package Manager (Package.resolved).',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to the project directory. Optional, defaults to current directory.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const projectPath = (args.projectPath as string) || '.';

      logger.info(`Listing dependencies in: ${projectPath}`);

      const dependencies: Dependency[] = [];

      // Check for CocoaPods dependencies
      const podfileLockPath = join(projectPath, 'Podfile.lock');
      if (existsSync(podfileLockPath)) {
        logger.info('Parsing Podfile.lock');
        try {
          const lockContent = readFileSync(podfileLockPath, 'utf-8');
          const podMatches = lockContent.match(/^  - ([^\s(]+)\s+\(([^)]+)\)/gm);
          if (podMatches) {
            podMatches.forEach((match) => {
              const podMatch = match.match(/  - ([^\s(]+)\s+\(([^)]+)\)/);
              if (podMatch) {
                dependencies.push({
                  name: podMatch[1],
                  version: podMatch[2],
                  source: 'cocoapods',
                  isOutdated: false,
                });
              }
            });
          }
        } catch (e) {
          logger.warn('Could not parse Podfile.lock:', e);
        }
      }

      // Check for SPM dependencies
      const packageResolvedPath = join(projectPath, 'Package.resolved');
      if (existsSync(packageResolvedPath)) {
        logger.info('Parsing Package.resolved');
        try {
          const resolvedContent = readFileSync(packageResolvedPath, 'utf-8');
          const packageMatches = resolvedContent.match(/"identity":\s*"([^"]+)"[^}]*"version":\s*"([^"]+)"/g);
          if (packageMatches) {
            packageMatches.forEach((match) => {
              const identityMatch = match.match(/"identity":\s*"([^"]+)"/);
              const versionMatch = match.match(/"version":\s*"([^"]+)"/);
              if (identityMatch && versionMatch) {
                dependencies.push({
                  name: identityMatch[1],
                  version: versionMatch[1],
                  source: 'spm',
                  isOutdated: false,
                });
              }
            });
          }
        } catch (e) {
          logger.warn('Could not parse Package.resolved:', e);
        }
      }

      logger.info(`Found ${dependencies.length} dependencies`);

      return {
        success: true,
        data: {
          projectPath,
          dependencies,
          totalCount: dependencies.length,
          cocoaPodsCount: dependencies.filter((d) => d.source === 'cocoapods').length,
          spmCount: dependencies.filter((d) => d.source === 'spm').length,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in list-dependencies:', error);

      return {
        success: false,
        error: `Failed to list dependencies: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Check-outdated-deps tool
 * Check for outdated dependencies
 */
const checkOutdatedDeps: ToolDefinition = {
  name: 'check-outdated-deps',
  description: 'Check for outdated dependencies in both CocoaPods and Swift Package Manager.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to the project directory. Optional, defaults to current directory.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const projectPath = (args.projectPath as string) || '.';

      logger.info(`Checking for outdated dependencies in: ${projectPath}`);

      const outdatedPods: any[] = [];
      const outdatedPackages: any[] = [];

      // Check for outdated CocoaPods
      const podfilePath = join(projectPath, 'Podfile');
      if (existsSync(podfilePath)) {
        logger.info('Checking for outdated CocoaPods');
        const result = await execCommand('pod', ['outdated'], {
          cwd: projectPath,
          timeout: 300000,
        });

        if (result.exitCode === 0 && result.stdout) {
          // Parse pod outdated output
          const lines = result.stdout.split('\n');
          lines.forEach((line) => {
            const match = line.match(/^(\S+)\s+\((\S+)\s*->\s*(\S+)\)/);
            if (match) {
              outdatedPods.push({
                name: match[1],
                currentVersion: match[2],
                latestVersion: match[3],
              });
            }
          });
        }
      }

      // Check for outdated SPM packages
      const packageSwiftPath = join(projectPath, 'Package.swift');
      if (existsSync(packageSwiftPath)) {
        logger.info('Checking for outdated SPM packages');
        const result = await execCommand('swift', ['package', 'show-dependencies'], {
          cwd: projectPath,
          timeout: 300000,
        });

        if (result.exitCode === 0 && result.stdout) {
          // Parse show-dependencies output
          const lines = result.stdout.split('\n');
          lines.forEach((line) => {
            const match = line.match(/├──\s+(\S+)@(\S+)/);
            if (match) {
              outdatedPackages.push({
                name: match[1],
                version: match[2],
              });
            }
          });
        }
      }

      logger.info(`Found ${outdatedPods.length} outdated CocoaPods and ${outdatedPackages.length} SPM packages`);

      return {
        success: true,
        data: {
          projectPath,
          outdatedPods,
          outdatedPackages,
          totalOutdated: outdatedPods.length + outdatedPackages.length,
          message: `Found ${outdatedPods.length} outdated CocoaPods and ${outdatedPackages.length} outdated SPM packages`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in check-outdated-deps:', error);

      return {
        success: false,
        error: `Failed to check outdated dependencies: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Export all dependency tools
 */
export const dependencyTools: ToolDefinition[] = [
  podInstall,
  podUpdate,
  spmAddPackage,
  spmResolve,
  listDependencies,
  checkOutdatedDeps,
];

export default dependencyTools;
