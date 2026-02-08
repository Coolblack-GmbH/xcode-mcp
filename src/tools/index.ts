import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../utils/logger.js';

// Import tool arrays from each module
import { tools as setupTools } from './setup.js';
import { tools as projectTools } from './project.js';
import { tools as buildTools } from './build.js';
import { tools as testTools } from './test.js';
import { simulatorTools } from './simulator.js';
import { signingTools } from './signing.js';
import { distributeTools } from './distribute.js';
import { dependencyTools } from './dependencies.js';
import { profilingTools } from './profiling.js';
import { utilityTools } from './utility.js';
import { cicdTools } from './cicd.js';
import { filesystemTools } from './filesystem.js';

// Import types
import { ToolResult, ToolHandler } from '../types.js';

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
 * Register all tools with the MCP server
 */
export function registerTools(server: Server): void {
  const allTools: ToolDefinition[] = [
    ...setupTools,
    ...projectTools,
    ...buildTools,
    ...testTools,
    ...simulatorTools,
    ...signingTools,
    ...distributeTools,
    ...dependencyTools,
    ...profilingTools,
    ...utilityTools,
    ...cicdTools,
    ...filesystemTools,
  ];

  logger.info(`Registering ${allTools.length} tools`);

  /**
   * Handle listing all available tools
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: allTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  /**
   * Handle calling a specific tool
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = allTools.find((t) => t.name === name);

    if (!tool) {
      logger.error(`Unknown tool requested: ${name}`);
      throw new Error(`Unknown tool: ${name}`);
    }

    logger.info(`Calling tool: ${name}`, { args });

    try {
      const result = (await tool.handler(args || {})) as ToolResult;

      // Build content blocks: always include text, optionally include image
      const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ];

      // If the tool returned an image (e.g., simulator screenshot), add it as image content
      if (result._imageBase64 && result._imageMimeType) {
        content.push({
          type: 'image',
          data: result._imageBase64,
          mimeType: result._imageMimeType,
        });
        logger.info(`Tool ${name} returned image content (${result._imageMimeType})`);
      }

      return {
        content,
        isError: !result.success,
      };
    } catch (error) {
      logger.error(`Error executing tool: ${name}`, { error });
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Tool '${name}' crashed: ${errorMessage}`,
              data: null,
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  logger.info('Tools registered successfully');
}
