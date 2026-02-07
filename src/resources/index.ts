import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  Resource,
} from '@modelcontextprotocol/sdk/types.js';
import * as providers from './providers.js';
import { logger } from '../utils/logger.js';

/**
 * Register resource handlers with the MCP server
 */
export function registerResources(server: Server): void {
  /**
   * Handle listing available resources
   */
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    logger.debug('Listing available resources');

    const resources: Resource[] = [
      {
        uri: 'xcode://project/current',
        name: 'Current Project',
        description: 'Current Xcode project information',
        mimeType: 'application/json',
      },
      {
        uri: 'xcode://sdks',
        name: 'Installed SDKs',
        description: 'Available SDKs and platforms',
        mimeType: 'application/json',
      },
      {
        uri: 'xcode://certificates',
        name: 'Signing Certificates',
        description: 'Installed code signing certificates',
        mimeType: 'application/json',
      },
      {
        uri: 'xcode://profiles',
        name: 'Provisioning Profiles',
        description: 'Installed provisioning profiles',
        mimeType: 'application/json',
      },
      {
        uri: 'xcode://simulators',
        name: 'Simulators',
        description: 'Available simulator devices',
        mimeType: 'application/json',
      },
    ];

    return { resources };
  });

  /**
   * Handle listing resource templates
   */
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    logger.debug('Listing resource templates');

    return {
      resourceTemplates: [
        {
          uriTemplate: 'xcode://logs/{logPath}',
          name: 'Build Log',
          description: 'Build log by path',
        },
      ],
    };
  });

  /**
   * Handle reading specific resources
   */
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    logger.debug('Reading resource', { uri });

    try {
      if (uri === 'xcode://project/current') {
        const data = await providers.getProjectInfo();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      if (uri === 'xcode://sdks') {
        const data = await providers.getInstalledSDKs();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      if (uri === 'xcode://certificates') {
        const data = await providers.getSigningCertificates();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      if (uri === 'xcode://profiles') {
        const data = await providers.getProvisioningProfiles();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      if (uri === 'xcode://simulators') {
        const data = await providers.getSimulatorsList();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      if (uri.startsWith('xcode://logs/')) {
        const logPath = decodeURIComponent(uri.replace('xcode://logs/', ''));
        const content = await providers.getBuildLog(logPath);
        return {
          contents: [
            {
              uri,
              mimeType: 'text/plain',
              text: content,
            },
          ],
        };
      }

      throw new Error(`Unknown resource URI: ${uri}`);
    } catch (error) {
      logger.error('Error reading resource', { uri, error });
      throw error;
    }
  });

  logger.info('Resources registered successfully');
}
