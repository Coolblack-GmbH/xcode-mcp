# Developer Guide

This guide explains how to extend **@coolblack/xcode-mcp** with new tools, resources, and prompts.

## Prerequisites

- Node.js 18+
- TypeScript 5.3+
- A working Xcode installation (for testing tools)

## Project Structure

```
src/
  index.ts              # Server entry point (StdioServerTransport)
  types.ts              # Shared TypeScript types (ToolResult, ToolHandler, etc.)
  tools/                # 12 tool modules (64 tools total)
    index.ts            # Tool registration and routing
    setup.ts            # Environment setup tools
    project.ts          # Project management tools
    build.ts            # Build and archive tools
    test.ts             # Testing tools
    simulator.ts        # Simulator management tools
    signing.ts          # Code signing tools
    distribute.ts       # Distribution tools (IPA, App Store, TestFlight)
    dependencies.ts     # CocoaPods and SPM tools
    profiling.ts        # Instruments profiling tools
    utility.ts          # Utility tools (bundle ID, SDK info, etc.)
    cicd.ts             # CI/CD setup tools
    filesystem.ts       # Filesystem access tools
  resources/            # MCP resource providers
    index.ts            # Resource registration
    providers.ts        # Resource data providers
  prompts/              # Workflow prompt templates
    index.ts            # Prompt registration
    templates.ts        # Prompt template definitions
  utils/
    exec.ts             # Subprocess execution (execCommand, execXcode, execSimctl)
    logger.ts           # Stderr-based logging (preserves stdout for JSON-RPC)
    paths.ts            # Path helpers (find projects, Xcode paths, simulators)
    errors.ts           # Build error parsing and fix suggestions
```

## Adding a New Tool

### 1. Create the Tool Definition

Each tool is a `ToolDefinition` object with a name, description, JSON Schema input, and an async handler function.

Create a new file in `src/tools/` or add to an existing module:

```typescript
import { ToolResult, ToolHandler } from '../types.js';
import { execCommand } from '../utils/exec.js';
import { logger } from '../utils/logger.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

const myNewTool: ToolDefinition = {
  name: 'my-new-tool',
  description: 'Description of what this tool does.',
  inputSchema: {
    type: 'object',
    properties: {
      requiredParam: {
        type: 'string',
        description: 'A required parameter.',
      },
      optionalParam: {
        type: 'boolean',
        description: 'An optional parameter. Defaults to false.',
      },
    },
    required: ['requiredParam'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const requiredParam = args.requiredParam as string;
      const optionalParam = (args.optionalParam as boolean) ?? false;

      // Your tool logic here
      const result = await execCommand('some-command', ['--flag', requiredParam]);

      return {
        success: true,
        data: {
          output: result.stdout.trim(),
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`my-new-tool failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

// Export as array
export const myTools: ToolDefinition[] = [myNewTool];
```

### 2. Register the Tool

Import your tools in `src/tools/index.ts`:

```typescript
import { myTools } from './my-module.js';

// Add to the allTools array:
const allTools: ToolDefinition[] = [
  ...setupTools,
  ...projectTools,
  // ...existing tools...
  ...myTools,        // <-- add here
];
```

### 3. Build and Test

```bash
npm run build     # Compile TypeScript
npm run dev       # Or use watch mode during development
```

After building, restart the MCP server process. Node.js caches modules in memory, so a restart is required for changes to take effect.

## Key Types

### ToolResult

Every tool handler must return a `ToolResult`:

```typescript
interface ToolResult {
  success: boolean;       // Whether the operation succeeded
  data: unknown;          // Result data (any structure)
  error?: string;         // Error message if success is false
  warnings?: string[];    // Optional warnings
  executionTime: number;  // Duration in milliseconds
  _imageBase64?: string;  // Optional base64-encoded image
  _imageMimeType?: string; // MIME type for the image (e.g., 'image/png')
}
```

### ToolHandler

```typescript
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;
```

## Utility Functions

### Command Execution (`utils/exec.ts`)

- `execCommand(cmd, args)` -- General command execution via `execFile`
- `execShell(command)` -- Shell command execution via `exec`
- `execXcode(cmd, args)` -- Xcode commands with 600s timeout
- `execSimctl(args)` -- Simulator control via `xcrun simctl` with 300s timeout
- `checkPlatformSDK(platform)` -- Check if a platform SDK is installed
- `checkSimulatorRuntime(platform)` -- Check if a simulator runtime is available

### Path Helpers (`utils/paths.ts`)

- `findProjectPath(dir?)` -- Auto-detect `.xcodeproj` or `.xcworkspace`
- `getXcodePath()` -- Get active Xcode installation path
- `getDerivedDataPath()` -- Get DerivedData directory
- `getAvailableSimulators()` -- List available simulators

### Error Parsing (`utils/errors.ts`)

- `parseXcodeBuildErrors(output)` -- Extract structured errors from xcodebuild output
- `suggestFix(error)` -- Generate context-specific fix suggestions
- `formatErrors(errors)` -- Format errors for human-readable display

### Logging (`utils/logger.ts`)

Always use the stderr-based logger instead of `console.log` to avoid interfering with JSON-RPC communication on stdout:

```typescript
import { logger } from '../utils/logger.js';

logger.info('Tool started');
logger.debug('Debug details', { key: 'value' });
logger.warn('Something unexpected');
logger.error('Operation failed', { error });
```

## Image Responses

Tools can return images (e.g., simulator screenshots) by setting `_imageBase64` and `_imageMimeType` on the `ToolResult`. The server automatically includes these as MCP image content blocks alongside the text response.

## Adding Resources

Resources provide direct data access via MCP resource URIs. Add new resources in `src/resources/providers.ts` and register them in `src/resources/index.ts`.

## Adding Prompts

Prompts are workflow templates that guide users through common tasks. Add new prompts in `src/prompts/templates.ts` and register them in `src/prompts/index.ts`.

## Code Style

- ESM modules (use `.js` extension in imports, even for TypeScript files)
- Strict TypeScript (`strict: true` in tsconfig)
- All tool handlers are async and return `ToolResult`
- Use `logger` for all output (never `console.log`)
- Error handling: catch errors and return `{ success: false, error: ... }` instead of throwing
