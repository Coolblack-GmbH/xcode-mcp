#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';
import { logger } from './utils/logger.js';

const SERVER_NAME = '@coolblack/xcode-mcp';
const SERVER_VERSION = '1.1.0';

/**
 * Main server entry point
 */
async function main() {
  logger.info(`Starting ${SERVER_NAME} v${SERVER_VERSION}`);

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  // Register all components
  registerTools(server);
  registerResources(server);
  registerPrompts(server);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info(`${SERVER_NAME} is running and ready to accept requests`);
}

// Prevent unhandled errors from crashing the server
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception (server continues running)', { error: error.message });
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection (server continues running)', { reason: String(reason) });
});

// Run the server
main().catch((error) => {
  logger.error('Fatal error starting server', { error });
  process.exit(1);
});
