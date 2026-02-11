import { ToolResult, ToolHandler } from '../types.js';
import { execCommand } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync } from 'fs';
import { join, basename, extname } from 'path';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * manage-asset-catalog — List, add, or remove image sets in .xcassets catalogs
 */
const manageAssetCatalog: ToolDefinition = {
  name: 'manage-asset-catalog',
  description: 'Manage .xcassets asset catalogs: list all image sets, add new image sets with images, or remove existing ones. Automatically generates Contents.json.',
  inputSchema: {
    type: 'object',
    properties: {
      catalogPath: {
        type: 'string',
        description: 'Path to the .xcassets directory',
      },
      action: {
        type: 'string',
        enum: ['list', 'add', 'remove', 'info'],
        description: 'Action: list (show all sets), add (create imageset), remove (delete imageset), info (details of one set)',
      },
      imageSetName: {
        type: 'string',
        description: 'Name of the image set (for add/remove/info actions)',
      },
      imagePath: {
        type: 'string',
        description: 'Path to the source image file (for add action). Will be copied into the image set.',
      },
      scale: {
        type: 'string',
        enum: ['1x', '2x', '3x', 'universal'],
        description: 'Scale factor for the image (default: universal for single-scale, or specify 1x/2x/3x)',
      },
    },
    required: ['catalogPath', 'action'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const catalogPath = args.catalogPath as string;
      const action = args.action as string;
      const imageSetName = args.imageSetName as string | undefined;
      const imagePath = args.imagePath as string | undefined;
      const scale = (args.scale as string) || 'universal';

      if (!existsSync(catalogPath)) {
        return {
          success: false,
          error: `Asset-Katalog nicht gefunden: ${catalogPath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Asset catalog ${action} on ${catalogPath}`);

      // LIST action
      if (action === 'list') {
        const entries = readdirSync(catalogPath, { withFileTypes: true });
        const sets = entries
          .filter((e) => e.isDirectory() && (e.name.endsWith('.imageset') || e.name.endsWith('.colorset') || e.name.endsWith('.appiconset')))
          .map((e) => {
            const setPath = join(catalogPath, e.name);
            const type = e.name.endsWith('.imageset') ? 'imageset'
              : e.name.endsWith('.colorset') ? 'colorset'
              : 'appiconset';
            const name = e.name.replace(/\.(imageset|colorset|appiconset)$/, '');

            let contents: any = null;
            const contentsPath = join(setPath, 'Contents.json');
            if (existsSync(contentsPath)) {
              try {
                contents = JSON.parse(readFileSync(contentsPath, 'utf-8'));
              } catch {
                // ignore
              }
            }

            return { name, type, path: setPath, hasContents: !!contents };
          });

        return {
          success: true,
          data: {
            catalogPath,
            sets,
            count: sets.length,
          },
          executionTime: Date.now() - startTime,
        };
      }

      // INFO action
      if (action === 'info') {
        if (!imageSetName) {
          return { success: false, error: 'imageSetName ist erforderlich fuer info', data: null, executionTime: Date.now() - startTime };
        }

        const setDir = findImageSetDir(catalogPath, imageSetName);
        if (!setDir) {
          return { success: false, error: `Image Set "${imageSetName}" nicht gefunden`, data: null, executionTime: Date.now() - startTime };
        }

        const contentsPath = join(setDir, 'Contents.json');
        let contents: any = null;
        if (existsSync(contentsPath)) {
          contents = JSON.parse(readFileSync(contentsPath, 'utf-8'));
        }

        const files = readdirSync(setDir).filter((f) => f !== 'Contents.json');

        return {
          success: true,
          data: {
            imageSetName,
            path: setDir,
            files,
            contents,
          },
          executionTime: Date.now() - startTime,
        };
      }

      // ADD action
      if (action === 'add') {
        if (!imageSetName) {
          return { success: false, error: 'imageSetName ist erforderlich fuer add', data: null, executionTime: Date.now() - startTime };
        }

        const setDir = join(catalogPath, `${imageSetName}.imageset`);
        if (!existsSync(setDir)) {
          mkdirSync(setDir, { recursive: true });
        }

        // Copy image if provided
        let imageFileName: string | undefined;
        if (imagePath && existsSync(imagePath)) {
          const ext = extname(imagePath);
          imageFileName = `${imageSetName}${ext}`;
          copyFileSync(imagePath, join(setDir, imageFileName));
        }

        // Generate Contents.json
        const contentsJson = generateImagesetContents(imageFileName, scale);
        writeFileSync(join(setDir, 'Contents.json'), JSON.stringify(contentsJson, null, 2));

        return {
          success: true,
          data: {
            imageSetName,
            path: setDir,
            imageFile: imageFileName,
            scale,
            message: `Image Set "${imageSetName}" erfolgreich erstellt`,
          },
          executionTime: Date.now() - startTime,
        };
      }

      // REMOVE action
      if (action === 'remove') {
        if (!imageSetName) {
          return { success: false, error: 'imageSetName ist erforderlich fuer remove', data: null, executionTime: Date.now() - startTime };
        }

        const setDir = findImageSetDir(catalogPath, imageSetName);
        if (!setDir) {
          return { success: false, error: `Image Set "${imageSetName}" nicht gefunden`, data: null, executionTime: Date.now() - startTime };
        }

        // Use rm -rf to remove the directory
        const rmResult = await execCommand('rm', ['-rf', setDir]);
        if (rmResult.exitCode !== 0) {
          return {
            success: false,
            error: `Konnte Image Set nicht loeschen: ${rmResult.stderr}`,
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        return {
          success: true,
          data: {
            imageSetName,
            removedPath: setDir,
            message: `Image Set "${imageSetName}" erfolgreich entfernt`,
          },
          executionTime: Date.now() - startTime,
        };
      }

      return {
        success: false,
        error: `Unbekannte Aktion: ${action}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in manage-asset-catalog:', error);
      return {
        success: false,
        error: `Fehler bei Asset-Katalog-Operation: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * add-app-icon — Set up app icon from a 1024x1024 image
 */
const addAppIcon: ToolDefinition = {
  name: 'add-app-icon',
  description: 'Set up app icon from a 1024x1024 source image. Creates the universal AppIcon.appiconset with proper Contents.json. Validates image dimensions via sips.',
  inputSchema: {
    type: 'object',
    properties: {
      catalogPath: {
        type: 'string',
        description: 'Path to the .xcassets directory',
      },
      iconPath: {
        type: 'string',
        description: 'Path to the 1024x1024 source icon image (PNG recommended)',
      },
      iconSetName: {
        type: 'string',
        description: 'Name of the app icon set (default: AppIcon)',
      },
    },
    required: ['catalogPath', 'iconPath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const catalogPath = args.catalogPath as string;
      const iconPath = args.iconPath as string;
      const iconSetName = (args.iconSetName as string) || 'AppIcon';

      if (!existsSync(catalogPath)) {
        return {
          success: false,
          error: `Asset-Katalog nicht gefunden: ${catalogPath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      if (!existsSync(iconPath)) {
        return {
          success: false,
          error: `Icon-Datei nicht gefunden: ${iconPath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Adding app icon from ${iconPath} to ${catalogPath}`);

      // Validate image dimensions using sips
      const sipsResult = await execCommand('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', iconPath]);
      if (sipsResult.exitCode === 0) {
        const widthMatch = sipsResult.stdout.match(/pixelWidth:\s*(\d+)/);
        const heightMatch = sipsResult.stdout.match(/pixelHeight:\s*(\d+)/);

        if (widthMatch && heightMatch) {
          const width = parseInt(widthMatch[1]);
          const height = parseInt(heightMatch[1]);

          if (width !== 1024 || height !== 1024) {
            return {
              success: false,
              error: `Icon muss 1024x1024 Pixel sein, ist aber ${width}x${height}`,
              data: null,
              executionTime: Date.now() - startTime,
            };
          }
        }
      }

      // Create appiconset directory
      const iconSetDir = join(catalogPath, `${iconSetName}.appiconset`);
      if (!existsSync(iconSetDir)) {
        mkdirSync(iconSetDir, { recursive: true });
      }

      // Copy icon file
      const ext = extname(iconPath);
      const iconFileName = `${iconSetName}${ext}`;
      copyFileSync(iconPath, join(iconSetDir, iconFileName));

      // Generate universal Contents.json (Xcode 15+ single-size format)
      const contentsJson = {
        images: [
          {
            filename: iconFileName,
            idiom: 'universal',
            platform: 'ios',
            size: '1024x1024',
          },
        ],
        info: {
          author: 'xcode-mcp',
          version: 1,
        },
      };

      writeFileSync(join(iconSetDir, 'Contents.json'), JSON.stringify(contentsJson, null, 2));

      return {
        success: true,
        data: {
          catalogPath,
          iconSetDir,
          iconFileName,
          dimensions: '1024x1024',
          message: `App-Icon "${iconSetName}" erfolgreich erstellt`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in add-app-icon:', error);
      return {
        success: false,
        error: `Fehler beim Hinzufuegen des App-Icons: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Helper: find an image set directory by name within a catalog
 */
function findImageSetDir(catalogPath: string, name: string): string | undefined {
  const suffixes = ['.imageset', '.colorset', '.appiconset'];
  for (const suffix of suffixes) {
    const dir = join(catalogPath, `${name}${suffix}`);
    if (existsSync(dir)) return dir;
  }
  return undefined;
}

/**
 * Helper: generate Contents.json for an imageset
 */
function generateImagesetContents(filename?: string, scale?: string): any {
  if (scale === 'universal' || !scale) {
    return {
      images: [
        {
          ...(filename ? { filename } : {}),
          idiom: 'universal',
        },
      ],
      info: {
        author: 'xcode-mcp',
        version: 1,
      },
    };
  }

  // Individual scale entries
  const images = ['1x', '2x', '3x'].map((s) => ({
    ...(s === scale && filename ? { filename } : {}),
    idiom: 'universal',
    scale: s,
  }));

  return {
    images,
    info: {
      author: 'xcode-mcp',
      version: 1,
    },
  };
}

export const assetTools: ToolDefinition[] = [
  manageAssetCatalog,
  addAppIcon,
];

export default assetTools;
