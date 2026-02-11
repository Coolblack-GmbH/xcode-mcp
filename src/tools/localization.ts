import { ToolResult, ToolHandler } from '../types.js';
import { execXcode } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { findProjectPath } from '../utils/paths.js';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, basename, extname } from 'path';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * export-localizations — Export localizations from an Xcode project
 */
const exportLocalizations: ToolDefinition = {
  name: 'export-localizations',
  description: 'Export localizations from an Xcode project to .xcloc files for translation. Uses xcodebuild -exportLocalizations.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to .xcodeproj or .xcworkspace. Defaults to auto-detected project.',
      },
      outputPath: {
        type: 'string',
        description: 'Directory to export .xcloc files to',
      },
      locales: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific locales to export (e.g. ["de", "fr"]). Exports all if not specified.',
      },
    },
    required: ['outputPath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      let projectPath = args.projectPath as string | undefined;
      const outputPath = args.outputPath as string;
      const locales = args.locales as string[] | undefined;

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

      logger.info(`Exporting localizations from ${projectPath} to ${outputPath}`);

      const projectType = projectPath.endsWith('.xcworkspace') ? 'workspace' : 'project';
      const exportArgs = [
        '-exportLocalizations',
        '-localizationPath', outputPath,
        `-${projectType}`, projectPath,
      ];

      if (locales && locales.length > 0) {
        for (const locale of locales) {
          exportArgs.push('-exportLanguage', locale);
        }
      }

      const result = await execXcode('xcodebuild', exportArgs);

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: `Export fehlgeschlagen: ${result.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      return {
        success: true,
        data: {
          projectPath,
          outputPath,
          locales: locales || 'all',
          message: 'Lokalisierungen erfolgreich exportiert',
          output: result.stdout.substring(0, 5000),
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in export-localizations:', error);
      return {
        success: false,
        error: `Fehler beim Exportieren der Lokalisierungen: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * import-localizations — Import translated .xcloc files back into the project
 */
const importLocalizations: ToolDefinition = {
  name: 'import-localizations',
  description: 'Import translated .xcloc files back into an Xcode project. Uses xcodebuild -importLocalizations.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to .xcodeproj or .xcworkspace. Defaults to auto-detected project.',
      },
      xclocPath: {
        type: 'string',
        description: 'Path to the .xcloc file to import',
      },
      mergePolicy: {
        type: 'string',
        enum: ['keep-current', 'replace-all'],
        description: 'How to handle existing translations (default: keep-current)',
      },
    },
    required: ['xclocPath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      let projectPath = args.projectPath as string | undefined;
      const xclocPath = args.xclocPath as string;

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

      if (!existsSync(xclocPath)) {
        return {
          success: false,
          error: `XCLOC-Datei nicht gefunden: ${xclocPath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Importing localizations from ${xclocPath} into ${projectPath}`);

      const projectType = projectPath.endsWith('.xcworkspace') ? 'workspace' : 'project';
      const importArgs = [
        '-importLocalizations',
        '-localizationPath', xclocPath,
        `-${projectType}`, projectPath,
      ];

      const result = await execXcode('xcodebuild', importArgs);

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: `Import fehlgeschlagen: ${result.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      return {
        success: true,
        data: {
          projectPath,
          xclocPath,
          message: 'Lokalisierungen erfolgreich importiert',
          output: result.stdout.substring(0, 5000),
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in import-localizations:', error);
      return {
        success: false,
        error: `Fehler beim Importieren der Lokalisierungen: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * list-localization-status — Show translation coverage per locale
 */
const listLocalizationStatus: ToolDefinition = {
  name: 'list-localization-status',
  description: 'Analyze .xcstrings (String Catalogs) or .strings files to show translation coverage per locale. Reports missing translations.',
  inputSchema: {
    type: 'object',
    properties: {
      projectDir: {
        type: 'string',
        description: 'Root directory of the project to scan for localization files',
      },
      format: {
        type: 'string',
        enum: ['xcstrings', 'strings', 'auto'],
        description: 'File format to scan (default: auto - detects both)',
      },
    },
    required: ['projectDir'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const projectDir = args.projectDir as string;
      const format = (args.format as string) || 'auto';

      logger.info(`Scanning localization status in ${projectDir}`);

      const localeStats: Record<string, { total: number; translated: number; missing: string[] }> = {};

      // Scan for .xcstrings files (String Catalogs - Xcode 15+)
      if (format === 'auto' || format === 'xcstrings') {
        const xcstringsFiles = findFilesRecursive(projectDir, '.xcstrings');

        for (const filePath of xcstringsFiles) {
          try {
            const content = JSON.parse(readFileSync(filePath, 'utf-8'));
            const strings = content.strings || {};
            const sourceLanguage = content.sourceLanguage || 'en';

            for (const [key, entry] of Object.entries(strings) as [string, any][]) {
              const localizations = entry.localizations || {};

              // Get all available locales
              for (const locale of Object.keys(localizations)) {
                if (!localeStats[locale]) {
                  localeStats[locale] = { total: 0, translated: 0, missing: [] };
                }
              }

              // Count translations
              const allLocales = new Set(Object.keys(localeStats));
              allLocales.add(sourceLanguage);

              for (const locale of allLocales) {
                if (!localeStats[locale]) {
                  localeStats[locale] = { total: 0, translated: 0, missing: [] };
                }
                localeStats[locale].total++;

                if (localizations[locale]) {
                  const locData = localizations[locale];
                  if (locData.stringUnit?.state === 'translated' || locData.stringUnit?.value || locale === sourceLanguage) {
                    localeStats[locale].translated++;
                  } else {
                    localeStats[locale].missing.push(key);
                  }
                } else if (locale === sourceLanguage) {
                  localeStats[locale].translated++;
                } else {
                  localeStats[locale].missing.push(key);
                }
              }
            }
          } catch {
            logger.warn(`Konnte ${filePath} nicht parsen`);
          }
        }
      }

      // Scan for .strings files
      if (format === 'auto' || format === 'strings') {
        const lprojDirs = findFilesRecursive(projectDir, '.lproj', true);

        for (const lprojDir of lprojDirs) {
          const locale = basename(lprojDir, '.lproj');
          if (!localeStats[locale]) {
            localeStats[locale] = { total: 0, translated: 0, missing: [] };
          }

          const stringsFiles = readdirSync(lprojDir).filter((f) => f.endsWith('.strings'));
          for (const stringsFile of stringsFiles) {
            try {
              const content = readFileSync(join(lprojDir, stringsFile), 'utf-8');
              const entries = content.match(/^"[^"]+"\s*=/gm) || [];
              localeStats[locale].total += entries.length;
              localeStats[locale].translated += entries.length;
            } catch {
              // Skip unreadable files
            }
          }
        }
      }

      // Calculate coverage percentages
      const summary = Object.entries(localeStats).map(([locale, stats]) => ({
        locale,
        total: stats.total,
        translated: stats.translated,
        missing: stats.total - stats.translated,
        coverage: stats.total > 0 ? Math.round((stats.translated / stats.total) * 100) : 0,
        missingKeys: stats.missing.slice(0, 50), // Limit to 50 per locale
      }));

      summary.sort((a, b) => a.coverage - b.coverage);

      return {
        success: true,
        data: {
          projectDir,
          locales: summary,
          localeCount: summary.length,
          overallCoverage: summary.length > 0
            ? Math.round(summary.reduce((s, l) => s + l.coverage, 0) / summary.length)
            : 0,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in list-localization-status:', error);
      return {
        success: false,
        error: `Fehler beim Analysieren der Lokalisierungen: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Helper: recursively find files with a given extension
 */
function findFilesRecursive(dir: string, ext: string, dirsOnly = false): string[] {
  const results: string[] = [];

  if (!existsSync(dir)) return results;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (dirsOnly && entry.isDirectory() && entry.name.endsWith(ext)) {
        results.push(fullPath);
      } else if (!dirsOnly && entry.isFile() && entry.name.endsWith(ext)) {
        results.push(fullPath);
      }

      if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.endsWith(ext)) {
        results.push(...findFilesRecursive(fullPath, ext, dirsOnly));
      }
    }
  } catch {
    // Skip directories we can't read
  }

  return results;
}

export const localizationTools: ToolDefinition[] = [
  exportLocalizations,
  importLocalizations,
  listLocalizationStatus,
];

export default localizationTools;
