import { ToolResult, ToolHandler } from '../types.js';
import { execCommand } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { ensureSafeProjectPath } from '../utils/paths.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * create-swift-package — Initialize a new Swift Package and optionally configure it
 */
const createSwiftPackage: ToolDefinition = {
  name: 'create-swift-package',
  description: 'Create a new Swift Package with configurable type (library/executable/macro), targets, platform support, and dependencies. Generates Package.swift and source structure.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Package name',
      },
      outputPath: {
        type: 'string',
        description: 'Directory to create the package in (defaults to ~/Developer/)',
      },
      type: {
        type: 'string',
        enum: ['library', 'executable', 'macro', 'build-tool-plugin', 'command-plugin', 'empty'],
        description: 'Package type (default: library)',
      },
      platforms: {
        type: 'array',
        items: { type: 'string' },
        description: 'Supported platforms (e.g. [".iOS(.v16)", ".macOS(.v13)"])',
      },
      dependencies: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Git URL of the dependency' },
            from: { type: 'string', description: 'Minimum version (e.g. "5.9.0")' },
          },
        },
        description: 'SPM dependencies to add to Package.swift',
      },
      targets: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional target names to create (beyond the default)',
      },
      testTarget: {
        type: 'boolean',
        description: 'Include a test target (default: true)',
      },
    },
    required: ['name'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const name = args.name as string;
      const rawOutputPath = (args.outputPath as string) || join(process.env.HOME || '~', 'Developer');
      const type = (args.type as string) || 'library';
      const platforms = args.platforms as string[] | undefined;
      const dependencies = args.dependencies as Array<{ url: string; from: string }> | undefined;
      const extraTargets = args.targets as string[] | undefined;
      const testTarget = args.testTarget !== false;

      logger.info(`Creating Swift Package: ${name} (${type})`);

      // Ensure safe path
      const { path: safePath } = ensureSafeProjectPath(rawOutputPath, name);
      const packageDir = resolve(safePath, safePath.endsWith(name) ? '' : name);

      if (!existsSync(packageDir)) {
        mkdirSync(packageDir, { recursive: true });
      }

      // Run swift package init
      const initArgs = ['package', 'init', '--name', name, '--type', type];
      const initResult = await execCommand('swift', initArgs, {
        cwd: packageDir,
        timeout: 60000,
      });

      if (initResult.exitCode !== 0) {
        return {
          success: false,
          error: `swift package init fehlgeschlagen: ${initResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Customize Package.swift if platforms or dependencies are specified
      const packageSwiftPath = join(packageDir, 'Package.swift');
      if ((platforms && platforms.length > 0) || (dependencies && dependencies.length > 0) || extraTargets) {
        let manifest = readFileSync(packageSwiftPath, 'utf-8');

        // Add platforms
        if (platforms && platforms.length > 0) {
          const platformsStr = `    platforms: [\n        ${platforms.join(',\n        ')}\n    ],`;
          // Insert after "name: ..." line
          manifest = manifest.replace(
            /(name:\s*"[^"]+",?)/,
            `$1\n${platformsStr}`,
          );
        }

        // Add dependencies
        if (dependencies && dependencies.length > 0) {
          const depsStr = dependencies
            .map((d) => `        .package(url: "${d.url}", from: "${d.from}")`)
            .join(',\n');

          // Replace empty dependencies array or add if missing
          if (manifest.includes('dependencies: [')) {
            manifest = manifest.replace(
              /dependencies:\s*\[\s*\]/,
              `dependencies: [\n${depsStr}\n    ]`,
            );
          } else {
            manifest = manifest.replace(
              /(name:\s*"[^"]+",?(\s*platforms:\s*\[[^\]]*\],?)?)/,
              `$1\n    dependencies: [\n${depsStr}\n    ],`,
            );
          }
        }

        // Add extra targets
        if (extraTargets && extraTargets.length > 0) {
          for (const target of extraTargets) {
            const targetSrcDir = join(packageDir, 'Sources', target);
            if (!existsSync(targetSrcDir)) {
              mkdirSync(targetSrcDir, { recursive: true });
              writeFileSync(join(targetSrcDir, `${target}.swift`), `// ${target} module\n`);
            }

            const targetEntry = `        .target(\n            name: "${target}"),`;
            manifest = manifest.replace(
              /(targets:\s*\[)/,
              `$1\n${targetEntry}`,
            );
          }
        }

        writeFileSync(packageSwiftPath, manifest);
      }

      // Resolve dependencies if any were added
      if (dependencies && dependencies.length > 0) {
        await execCommand('swift', ['package', 'resolve'], {
          cwd: packageDir,
          timeout: 120000,
        });
      }

      return {
        success: true,
        data: {
          name,
          type,
          path: packageDir,
          packageSwift: packageSwiftPath,
          platforms: platforms || ['default'],
          dependencies: dependencies?.map((d) => d.url) || [],
          extraTargets: extraTargets || [],
          hasTestTarget: testTarget,
          message: `Swift Package "${name}" erfolgreich erstellt`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in create-swift-package:', error);
      return {
        success: false,
        error: `Fehler beim Erstellen des Swift Package: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

export const swiftPackageTools: ToolDefinition[] = [
  createSwiftPackage,
];

export default swiftPackageTools;
