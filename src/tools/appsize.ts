import { ToolResult, ToolHandler } from '../types.js';
import { execCommand, execXcode } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join, extname, basename } from 'path';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * analyze-app-size — Analyze app bundle size breakdown
 */
const analyzeAppSize: ToolDefinition = {
  name: 'analyze-app-size',
  description: 'Analyze an .app bundle or .ipa size breakdown: total size, frameworks, assets, code, resources per category. Optionally generates App Thinning report from an archive.',
  inputSchema: {
    type: 'object',
    properties: {
      appPath: {
        type: 'string',
        description: 'Path to .app bundle, .ipa file, or .xcarchive to analyze',
      },
      detailed: {
        type: 'boolean',
        description: 'Show per-file breakdown (default: false, only category totals)',
      },
      thinning: {
        type: 'boolean',
        description: 'Generate App Thinning Size Report from archive (requires .xcarchive path)',
      },
      exportOptionsPlist: {
        type: 'string',
        description: 'Path to ExportOptions.plist for thinning report (optional)',
      },
    },
    required: ['appPath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const appPath = args.appPath as string;
      const detailed = (args.detailed as boolean) || false;
      const thinning = (args.thinning as boolean) || false;
      const exportOptionsPlist = args.exportOptionsPlist as string | undefined;

      if (!existsSync(appPath)) {
        return {
          success: false,
          error: `Pfad nicht gefunden: ${appPath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Analyzing app size: ${appPath}`);

      // Handle .ipa files — extract to temp for analysis
      let analysisPath = appPath;
      let ipaSize: number | undefined;

      if (appPath.endsWith('.ipa')) {
        ipaSize = statSync(appPath).size;
        // Look inside the IPA (it's a zip)
        const unzipResult = await execCommand('unzip', ['-l', appPath]);
        if (unzipResult.exitCode === 0) {
          const lines = unzipResult.stdout.split('\n');
          const categories: Record<string, { count: number; size: number; files: string[] }> = {};

          for (const line of lines) {
            const match = line.match(/^\s*(\d+)\s+\S+\s+\S+\s+(.+)$/);
            if (match) {
              const size = parseInt(match[1]);
              const filePath = match[2].trim();
              const category = categorizeFile(filePath);

              if (!categories[category]) {
                categories[category] = { count: 0, size: 0, files: [] };
              }
              categories[category].count++;
              categories[category].size += size;
              if (detailed) {
                categories[category].files.push(`${filePath} (${formatSize(size)})`);
              }
            }
          }

          return {
            success: true,
            data: {
              appPath,
              type: 'ipa',
              totalSize: ipaSize,
              totalSizeFormatted: formatSize(ipaSize),
              categories: Object.entries(categories)
                .sort(([, a], [, b]) => b.size - a.size)
                .map(([name, data]) => ({
                  category: name,
                  size: data.size,
                  sizeFormatted: formatSize(data.size),
                  fileCount: data.count,
                  percentage: Math.round((data.size / ipaSize!) * 100),
                  ...(detailed ? { files: data.files.slice(0, 50) } : {}),
                })),
            },
            executionTime: Date.now() - startTime,
          };
        }
      }

      // Handle .xcarchive — App Thinning report
      if (appPath.endsWith('.xcarchive') && thinning) {
        const thinningArgs = [
          '-exportArchive',
          '-archivePath', appPath,
          '-exportPath', `${appPath}-thinning`,
          '-exportOptionsPlist', exportOptionsPlist || createMinimalExportPlist(),
          '-exportThinning', 'true',
        ];

        const thinResult = await execXcode('xcodebuild', thinningArgs);

        // Look for App Thinning Size Report
        const reportPath = `${appPath}-thinning/App Thinning Size Report.txt`;
        let thinningReport: string | undefined;
        if (existsSync(reportPath)) {
          thinningReport = readFileSync(reportPath, 'utf-8');
        }

        return {
          success: thinResult.exitCode === 0,
          data: {
            appPath,
            type: 'xcarchive-thinning',
            thinningReport: thinningReport || thinResult.stdout.substring(0, 10000),
            message: thinningReport ? 'App Thinning Report erstellt' : 'Thinning nicht verfuegbar',
          },
          error: thinResult.exitCode !== 0 ? thinResult.stderr.substring(0, 1000) : undefined,
          executionTime: Date.now() - startTime,
        };
      }

      // Handle .app bundle or .xcarchive (size analysis)
      if (appPath.endsWith('.xcarchive')) {
        // Find .app inside archive
        const productsDir = join(appPath, 'Products', 'Applications');
        if (existsSync(productsDir)) {
          const apps = readdirSync(productsDir).filter((f) => f.endsWith('.app'));
          if (apps.length > 0) {
            analysisPath = join(productsDir, apps[0]);
          }
        }
      }

      // Analyze .app bundle
      const categories: Record<string, { count: number; size: number; files: string[] }> = {};
      let totalSize = 0;

      function walkDir(dir: string, prefix = '') {
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

            if (entry.isDirectory()) {
              // Special handling for .framework directories
              if (entry.name.endsWith('.framework') || entry.name.endsWith('.bundle')) {
                const size = getDirSize(fullPath);
                const cat = entry.name.endsWith('.framework') ? 'Frameworks' : 'Bundles';
                if (!categories[cat]) categories[cat] = { count: 0, size: 0, files: [] };
                categories[cat].count++;
                categories[cat].size += size;
                totalSize += size;
                if (detailed) {
                  categories[cat].files.push(`${relativePath} (${formatSize(size)})`);
                }
              } else {
                walkDir(fullPath, relativePath);
              }
            } else if (entry.isFile()) {
              const size = statSync(fullPath).size;
              totalSize += size;
              const category = categorizeFile(relativePath);

              if (!categories[category]) {
                categories[category] = { count: 0, size: 0, files: [] };
              }
              categories[category].count++;
              categories[category].size += size;
              if (detailed) {
                categories[category].files.push(`${relativePath} (${formatSize(size)})`);
              }
            }
          }
        } catch {
          // Skip directories we can't read
        }
      }

      walkDir(analysisPath);

      return {
        success: true,
        data: {
          appPath: analysisPath,
          type: appPath.endsWith('.xcarchive') ? 'xcarchive' : 'app',
          totalSize,
          totalSizeFormatted: formatSize(totalSize),
          categories: Object.entries(categories)
            .sort(([, a], [, b]) => b.size - a.size)
            .map(([name, data]) => ({
              category: name,
              size: data.size,
              sizeFormatted: formatSize(data.size),
              fileCount: data.count,
              percentage: totalSize > 0 ? Math.round((data.size / totalSize) * 100) : 0,
              ...(detailed ? { files: data.files.slice(0, 50) } : {}),
            })),
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in analyze-app-size:', error);
      return {
        success: false,
        error: `Fehler bei der App-Groessenanalyse: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Categorize a file by its extension/path
 */
function categorizeFile(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const name = basename(filePath).toLowerCase();
  const pathLower = filePath.toLowerCase();

  if (pathLower.includes('framework') || pathLower.includes('.dylib')) return 'Frameworks';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.pdf', '.svg'].includes(ext)) return 'Images';
  if (['.car'].includes(ext)) return 'Asset Catalogs';
  if (['.nib', '.storyboardc', '.xib'].includes(ext)) return 'Interface Builder';
  if (['.strings', '.stringsdict', '.xcstrings'].includes(ext)) return 'Localization';
  if (['.js', '.css', '.html', '.htm'].includes(ext)) return 'Web Content';
  if (['.json', '.plist', '.xml', '.yaml', '.yml'].includes(ext)) return 'Config/Data';
  if (['.momd', '.mom', '.omo'].includes(ext)) return 'Core Data';
  if (['.mlmodelc', '.mlmodel'].includes(ext)) return 'ML Models';
  if (['.mp3', '.wav', '.aac', '.m4a', '.caf'].includes(ext)) return 'Audio';
  if (['.mp4', '.mov', '.m4v'].includes(ext)) return 'Video';
  if (['.ttf', '.otf', '.ttc', '.woff', '.woff2'].includes(ext)) return 'Fonts';
  if (name === 'info.plist' || name === 'pkginfo') return 'Metadata';
  if (name === 'codesignature' || name === 'coderesources' || pathLower.includes('_codesignature')) return 'Code Signing';
  if (ext === '' && !filePath.includes('.')) return 'Executables';

  return 'Other';
}

/**
 * Format bytes to human-readable string
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exp);
  return `${value.toFixed(exp > 0 ? 1 : 0)} ${units[exp]}`;
}

/**
 * Get total size of a directory recursively
 */
function getDirSize(dir: string): number {
  let size = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        size += getDirSize(fullPath);
      } else if (entry.isFile()) {
        size += statSync(fullPath).size;
      }
    }
  } catch {
    // skip
  }
  return size;
}

/**
 * Create a minimal ExportOptions.plist content for thinning
 */
function createMinimalExportPlist(): string {
  // Write a temporary plist and return the path
  const { writeFileSync } = require('fs');
  const { join } = require('path');
  const { tmpdir } = require('os');
  const path = join(tmpdir(), 'ExportOptions-thinning.plist');
  writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>development</string>
    <key>thinning</key>
    <string>&lt;thin-for-all-variants&gt;</string>
</dict>
</plist>`);
  return path;
}

export const appSizeTools: ToolDefinition[] = [
  analyzeAppSize,
];

export default appSizeTools;
