import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  Prompt,
} from '@modelcontextprotocol/sdk/types.js';
import { promptTemplates } from './templates.js';
import { logger } from '../utils/logger.js';

/**
 * Register prompt handlers with the MCP server
 */
export function registerPrompts(server: Server): void {
  /**
   * Handle listing available prompts
   */
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    logger.debug('Listing available prompts');

    const prompts: Prompt[] = promptTemplates.map((template) => ({
      name: template.name,
      description: template.description,
      arguments: template.arguments,
    }));

    return { prompts };
  });

  /**
   * Handle getting a specific prompt with arguments
   */
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const promptName = request.params.name;
    logger.debug('Getting prompt', { name: promptName });

    const template = promptTemplates.find((p) => p.name === promptName);

    if (!template) {
      logger.error('Prompt not found', { name: promptName });
      throw new Error(`Prompt not found: ${promptName}`);
    }

    try {
      const args = request.params.arguments || {};
      const messages = template.getMessages(args);

      return { messages };
    } catch (error) {
      logger.error('Error generating prompt messages', { name: promptName, error });
      throw error;
    }
  });

  logger.info('Prompts registered successfully');
}
