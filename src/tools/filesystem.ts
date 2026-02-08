import { ToolResult, ToolHandler } from '../types.js';
import { logger } from '../utils/logger.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync } from 'fs';
import { join, dirname, basename, extname, resolve } from 'path';
import { homedir } from 'os';

/**
 * Tool definition interface
 */
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

// ============================================================================
// Security: Restrict file operations to safe directories
// ============================================================================

const ALLOWED_BASE_PATHS = [
  '/tmp',
  homedir(),
  '/var/folders',
];

function isPathAllowed(filePath: string): boolean {
  const resolved = resolve(filePath);
  return ALLOWED_BASE_PATHS.some(base => resolved.startsWith(base));
}

function validatePath(filePath: string): string | null {
  const resolved = resolve(filePath);
  if (!isPathAllowed(resolved)) {
    return `Path not allowed: ${resolved}. Allowed base paths: ${ALLOWED_BASE_PATHS.join(', ')}`;
  }
  return null;
}

// ============================================================================
// Tool: write-file
// ============================================================================

const writeFileTool: ToolDefinition = {
  name: 'write-file',
  description: 'Write content to a file on the host filesystem. Creates parent directories automatically. Use this to create or update Swift source files, configuration files, or any project files.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Absolute path to the file to write (e.g., /tmp/MyApp/MyApp/ContentView.swift)',
      },
      content: {
        type: 'string',
        description: 'The full content to write to the file',
      },
      createDirectories: {
        type: 'boolean',
        description: 'Create parent directories if they do not exist. Defaults to true.',
      },
    },
    required: ['filePath', 'content'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const filePath = args.filePath as string;
      const content = args.content as string;
      const createDirectories = (args.createDirectories as boolean | undefined) !== false;

      if (!filePath) {
        return {
          success: false,
          error: 'filePath is required',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const pathError = validatePath(filePath);
      if (pathError) {
        return {
          success: false,
          error: pathError,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const resolved = resolve(filePath);
      logger.info(`Writing file: ${resolved} (${content.length} bytes)`);

      // Create parent directories if needed
      if (createDirectories) {
        const dir = dirname(resolved);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
          logger.info(`Created directories: ${dir}`);
        }
      }

      writeFileSync(resolved, content, 'utf-8');

      return {
        success: true,
        data: {
          filePath: resolved,
          bytesWritten: Buffer.byteLength(content, 'utf-8'),
          created: true,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in write-file:', error);

      return {
        success: false,
        error: `Failed to write file: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

// ============================================================================
// Tool: read-file
// ============================================================================

const readFileTool: ToolDefinition = {
  name: 'read-file',
  description: 'Read the contents of a file on the host filesystem. Use this to inspect Swift source files, configuration files, or any project files.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Absolute path to the file to read',
      },
      maxLines: {
        type: 'number',
        description: 'Maximum number of lines to return. Defaults to all lines.',
      },
    },
    required: ['filePath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const filePath = args.filePath as string;
      const maxLines = args.maxLines as number | undefined;

      if (!filePath) {
        return {
          success: false,
          error: 'filePath is required',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const pathError = validatePath(filePath);
      if (pathError) {
        return {
          success: false,
          error: pathError,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const resolved = resolve(filePath);
      logger.info(`Reading file: ${resolved}`);

      if (!existsSync(resolved)) {
        return {
          success: false,
          error: `File not found: ${resolved}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const stat = statSync(resolved);
      if (stat.isDirectory()) {
        return {
          success: false,
          error: `Path is a directory, not a file: ${resolved}. Use list-directory instead.`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      let content = readFileSync(resolved, 'utf-8');
      let truncated = false;

      if (maxLines !== undefined && maxLines > 0) {
        const lines = content.split('\n');
        if (lines.length > maxLines) {
          content = lines.slice(0, maxLines).join('\n');
          truncated = true;
        }
      }

      return {
        success: true,
        data: {
          filePath: resolved,
          content,
          size: stat.size,
          lines: content.split('\n').length,
          truncated,
          lastModified: stat.mtime.toISOString(),
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in read-file:', error);

      return {
        success: false,
        error: `Failed to read file: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

// ============================================================================
// Tool: list-directory
// ============================================================================

const listDirectoryTool: ToolDefinition = {
  name: 'list-directory',
  description: 'List files and directories at a given path on the host filesystem. Shows file sizes and types. Use this to explore Xcode project structures.',
  inputSchema: {
    type: 'object',
    properties: {
      dirPath: {
        type: 'string',
        description: 'Absolute path to the directory to list',
      },
      recursive: {
        type: 'boolean',
        description: 'List files recursively (include subdirectories). Defaults to false.',
      },
      maxDepth: {
        type: 'number',
        description: 'Maximum recursion depth when recursive is true. Defaults to 3.',
      },
    },
    required: ['dirPath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const dirPath = args.dirPath as string;
      const recursive = (args.recursive as boolean) || false;
      const maxDepth = (args.maxDepth as number) || 3;

      if (!dirPath) {
        return {
          success: false,
          error: 'dirPath is required',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const pathError = validatePath(dirPath);
      if (pathError) {
        return {
          success: false,
          error: pathError,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const resolved = resolve(dirPath);
      logger.info(`Listing directory: ${resolved} (recursive: ${recursive})`);

      if (!existsSync(resolved)) {
        return {
          success: false,
          error: `Directory not found: ${resolved}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      interface FileEntry {
        name: string;
        path: string;
        type: 'file' | 'directory';
        size: number;
        extension: string;
        children?: FileEntry[];
      }

      function listDir(path: string, depth: number): FileEntry[] {
        const entries: FileEntry[] = [];

        try {
          const items = readdirSync(path);
          for (const item of items) {
            // Skip hidden files and common noise
            if (item.startsWith('.') || item === 'node_modules' || item === 'DerivedData') {
              continue;
            }

            const fullPath = join(path, item);
            try {
              const stat = statSync(fullPath);
              const entry: FileEntry = {
                name: item,
                path: fullPath,
                type: stat.isDirectory() ? 'directory' : 'file',
                size: stat.size,
                extension: stat.isFile() ? extname(item) : '',
              };

              if (stat.isDirectory() && recursive && depth < maxDepth) {
                entry.children = listDir(fullPath, depth + 1);
              }

              entries.push(entry);
            } catch {
              // Skip files we can't stat
            }
          }
        } catch {
          // Skip directories we can't read
        }

        // Sort: directories first, then files, alphabetically
        return entries.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      }

      const entries = listDir(resolved, 0);

      return {
        success: true,
        data: {
          dirPath: resolved,
          entries,
          totalEntries: entries.length,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in list-directory:', error);

      return {
        success: false,
        error: `Failed to list directory: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

// ============================================================================
// Tool: create-directory
// ============================================================================

const createDirectoryTool: ToolDefinition = {
  name: 'create-directory',
  description: 'Create a directory on the host filesystem. Creates parent directories automatically.',
  inputSchema: {
    type: 'object',
    properties: {
      dirPath: {
        type: 'string',
        description: 'Absolute path to the directory to create',
      },
    },
    required: ['dirPath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const dirPath = args.dirPath as string;

      if (!dirPath) {
        return {
          success: false,
          error: 'dirPath is required',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const pathError = validatePath(dirPath);
      if (pathError) {
        return {
          success: false,
          error: pathError,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const resolved = resolve(dirPath);
      logger.info(`Creating directory: ${resolved}`);

      if (existsSync(resolved)) {
        return {
          success: true,
          data: {
            dirPath: resolved,
            alreadyExisted: true,
          },
          executionTime: Date.now() - startTime,
        };
      }

      mkdirSync(resolved, { recursive: true });

      return {
        success: true,
        data: {
          dirPath: resolved,
          alreadyExisted: false,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in create-directory:', error);

      return {
        success: false,
        error: `Failed to create directory: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

// ============================================================================
// Tool: delete-file
// ============================================================================

const deleteFileTool: ToolDefinition = {
  name: 'delete-file',
  description: 'Delete a file or directory on the host filesystem. Use with caution.',
  inputSchema: {
    type: 'object',
    properties: {
      targetPath: {
        type: 'string',
        description: 'Absolute path to the file or directory to delete',
      },
      recursive: {
        type: 'boolean',
        description: 'If true, recursively delete directories and their contents. Required for non-empty directories. Defaults to false.',
      },
    },
    required: ['targetPath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const targetPath = args.targetPath as string;
      const recursive = (args.recursive as boolean) || false;

      if (!targetPath) {
        return {
          success: false,
          error: 'targetPath is required',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const pathError = validatePath(targetPath);
      if (pathError) {
        return {
          success: false,
          error: pathError,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const resolved = resolve(targetPath);
      logger.info(`Deleting: ${resolved} (recursive: ${recursive})`);

      if (!existsSync(resolved)) {
        return {
          success: true,
          data: {
            targetPath: resolved,
            alreadyDeleted: true,
          },
          executionTime: Date.now() - startTime,
        };
      }

      const stat = statSync(resolved);

      if (stat.isDirectory()) {
        if (recursive) {
          rmSync(resolved, { recursive: true, force: true });
        } else {
          // Try to remove empty directory
          try {
            rmSync(resolved);
          } catch {
            return {
              success: false,
              error: `Directory is not empty. Use recursive: true to delete: ${resolved}`,
              data: null,
              executionTime: Date.now() - startTime,
            };
          }
        }
      } else {
        unlinkSync(resolved);
      }

      return {
        success: true,
        data: {
          targetPath: resolved,
          type: stat.isDirectory() ? 'directory' : 'file',
          deleted: true,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in delete-file:', error);

      return {
        success: false,
        error: `Failed to delete: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Export all filesystem tools
 */
export const filesystemTools: ToolDefinition[] = [
  writeFileTool,
  readFileTool,
  listDirectoryTool,
  createDirectoryTool,
  deleteFileTool,
];

export default filesystemTools;
