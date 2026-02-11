import { ToolResult, ToolHandler } from '../types.js';
import { execCommand } from '../utils/exec.js';
import { ascGet, ascPatch, ascPost, ascUploadAsset, validateASCCredentials } from '../utils/asc-api.js';
import { logger } from '../utils/logger.js';
import { existsSync, statSync } from 'fs';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * manage-app-metadata — Read and update App Store listing metadata
 */
const manageAppMetadata: ToolDefinition = {
  name: 'manage-app-metadata',
  description: 'Read and update App Store listing metadata: app name, description, keywords, "What\'s New" text, promotional text, subtitle, and privacy URL. Requires App Store Connect API key.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'update'],
        description: 'Action: read (get current metadata) or update (change metadata fields)',
      },
      appId: {
        type: 'string',
        description: 'App Store Connect App ID (numeric)',
      },
      locale: {
        type: 'string',
        description: 'Locale to read/update (e.g. "de-DE", "en-US"). Default: all locales for read.',
      },
      fields: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Full app description' },
          keywords: { type: 'string', description: 'Keywords (comma-separated, max 100 chars)' },
          whatsNew: { type: 'string', description: '"What\'s New" release notes' },
          promotionalText: { type: 'string', description: 'Promotional text (can be updated without new version)' },
          subtitle: { type: 'string', description: 'App subtitle (max 30 chars)' },
          name: { type: 'string', description: 'App name (max 30 chars)' },
          privacyUrl: { type: 'string', description: 'Privacy policy URL' },
          supportUrl: { type: 'string', description: 'Support URL' },
          marketingUrl: { type: 'string', description: 'Marketing URL' },
        },
        description: 'Metadata fields to update (for update action)',
      },
      apiKeyPath: {
        type: 'string',
        description: 'Path to App Store Connect API key (.p8 file)',
      },
      apiKeyId: {
        type: 'string',
        description: 'API Key ID',
      },
      issuerId: {
        type: 'string',
        description: 'Issuer ID',
      },
    },
    required: ['action', 'appId', 'apiKeyPath', 'apiKeyId', 'issuerId'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const action = args.action as string;
      const appId = args.appId as string;
      const locale = args.locale as string | undefined;
      const fields = args.fields as Record<string, string> | undefined;

      const credsResult = validateASCCredentials(
        args.apiKeyPath as string,
        args.apiKeyId as string,
        args.issuerId as string,
      );
      if (typeof credsResult === 'string') {
        return { success: false, error: credsResult, data: null, executionTime: Date.now() - startTime };
      }
      const creds = credsResult;

      logger.info(`App metadata ${action} for app ${appId}`);

      if (action === 'read') {
        // Get the latest app store version
        const versionsData = await ascGet(
          `apps/${appId}/appStoreVersions`,
          { limit: 1, 'filter[appStoreState]': 'READY_FOR_SALE,PREPARE_FOR_SUBMISSION,WAITING_FOR_REVIEW,IN_REVIEW' },
          creds,
        );

        const version = versionsData.data?.[0];
        if (!version) {
          return {
            success: false,
            error: 'Keine aktive App Store Version gefunden',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        // Get localizations for this version
        const localizationsData = await ascGet(
          `appStoreVersions/${version.id}/appStoreVersionLocalizations`,
          { limit: 50, ...(locale ? { 'filter[locale]': locale } : {}) },
          creds,
        );

        const localizations = (localizationsData.data || []).map((loc: any) => ({
          id: loc.id,
          locale: loc.attributes?.locale,
          name: loc.attributes?.name,
          subtitle: loc.attributes?.subtitle,
          description: loc.attributes?.description,
          keywords: loc.attributes?.keywords,
          whatsNew: loc.attributes?.whatsNew,
          promotionalText: loc.attributes?.promotionalText,
          supportUrl: loc.attributes?.supportUrl,
          marketingUrl: loc.attributes?.marketingUrl,
          privacyUrl: loc.attributes?.privacyPolicyUrl,
        }));

        return {
          success: true,
          data: {
            appId,
            versionId: version.id,
            versionString: version.attributes?.versionString,
            appStoreState: version.attributes?.appStoreState,
            localizations,
          },
          executionTime: Date.now() - startTime,
        };
      }

      if (action === 'update') {
        if (!fields || Object.keys(fields).length === 0) {
          return { success: false, error: 'Keine Felder zum Aktualisieren angegeben', data: null, executionTime: Date.now() - startTime };
        }

        if (!locale) {
          return { success: false, error: 'locale ist erforderlich fuer Updates', data: null, executionTime: Date.now() - startTime };
        }

        // Get the latest version
        const versionsData = await ascGet(
          `apps/${appId}/appStoreVersions`,
          { limit: 1, 'filter[appStoreState]': 'PREPARE_FOR_SUBMISSION,READY_FOR_SALE' },
          creds,
        );

        const version = versionsData.data?.[0];
        if (!version) {
          return { success: false, error: 'Keine editierbare Version gefunden', data: null, executionTime: Date.now() - startTime };
        }

        // Find the localization for this locale
        const localizationsData = await ascGet(
          `appStoreVersions/${version.id}/appStoreVersionLocalizations`,
          { 'filter[locale]': locale },
          creds,
        );

        const localization = localizationsData.data?.[0];
        if (!localization) {
          return { success: false, error: `Lokalisierung fuer "${locale}" nicht gefunden`, data: null, executionTime: Date.now() - startTime };
        }

        // Map our field names to API field names
        const attributeMap: Record<string, string> = {
          description: 'description',
          keywords: 'keywords',
          whatsNew: 'whatsNew',
          promotionalText: 'promotionalText',
          subtitle: 'subtitle',
          name: 'name',
          privacyUrl: 'privacyPolicyUrl',
          supportUrl: 'supportUrl',
          marketingUrl: 'marketingUrl',
        };

        const attributes: Record<string, string> = {};
        for (const [key, value] of Object.entries(fields)) {
          const apiKey = attributeMap[key];
          if (apiKey) {
            attributes[apiKey] = value;
          }
        }

        // PATCH the localization
        await ascPatch(
          `appStoreVersionLocalizations/${localization.id}`,
          {
            data: {
              type: 'appStoreVersionLocalizations',
              id: localization.id,
              attributes,
            },
          },
          creds,
        );

        return {
          success: true,
          data: {
            appId,
            locale,
            updatedFields: Object.keys(fields),
            message: `Metadata fuer "${locale}" erfolgreich aktualisiert`,
          },
          executionTime: Date.now() - startTime,
        };
      }

      return { success: false, error: `Unbekannte Aktion: ${action}`, data: null, executionTime: Date.now() - startTime };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in manage-app-metadata:', error);
      return {
        success: false,
        error: `Fehler bei Metadata-Operation: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * manage-screenshots — Upload, list, or delete App Store screenshots
 */
const manageScreenshots: ToolDefinition = {
  name: 'manage-screenshots',
  description: 'Upload, list, or delete App Store screenshots for a specific locale and display type. Requires App Store Connect API key.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'upload', 'delete', 'reorder'],
        description: 'Action to perform',
      },
      appId: {
        type: 'string',
        description: 'App Store Connect App ID',
      },
      locale: {
        type: 'string',
        description: 'Locale (e.g. "de-DE", "en-US")',
      },
      displayType: {
        type: 'string',
        enum: [
          'APP_IPHONE_67',
          'APP_IPHONE_65',
          'APP_IPHONE_61',
          'APP_IPHONE_58',
          'APP_IPHONE_55',
          'APP_IPAD_PRO_3GEN_129',
          'APP_IPAD_PRO_129',
          'APP_IPAD_105',
        ],
        description: 'Screenshot display type (screen size category)',
      },
      screenshotPath: {
        type: 'string',
        description: 'Path to screenshot file to upload (for upload action)',
      },
      screenshotId: {
        type: 'string',
        description: 'Screenshot ID to delete (for delete action)',
      },
      apiKeyPath: { type: 'string', description: 'Path to .p8 API key' },
      apiKeyId: { type: 'string', description: 'API Key ID' },
      issuerId: { type: 'string', description: 'Issuer ID' },
    },
    required: ['action', 'appId', 'apiKeyPath', 'apiKeyId', 'issuerId'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const action = args.action as string;
      const appId = args.appId as string;
      const locale = args.locale as string | undefined;
      const displayType = args.displayType as string | undefined;
      const screenshotPath = args.screenshotPath as string | undefined;
      const screenshotId = args.screenshotId as string | undefined;

      const credsResult = validateASCCredentials(
        args.apiKeyPath as string,
        args.apiKeyId as string,
        args.issuerId as string,
      );
      if (typeof credsResult === 'string') {
        return { success: false, error: credsResult, data: null, executionTime: Date.now() - startTime };
      }
      const creds = credsResult;

      logger.info(`Screenshots ${action} for app ${appId}`);

      if (action === 'list') {
        // Get latest version → localization → screenshot sets
        const versionsData = await ascGet(
          `apps/${appId}/appStoreVersions`,
          { limit: 1 },
          creds,
        );

        const version = versionsData.data?.[0];
        if (!version) {
          return { success: false, error: 'Keine Version gefunden', data: null, executionTime: Date.now() - startTime };
        }

        const params: Record<string, any> = { limit: 50 };
        if (locale) params['filter[locale]'] = locale;

        const locData = await ascGet(
          `appStoreVersions/${version.id}/appStoreVersionLocalizations`,
          params,
          creds,
        );

        const results: any[] = [];
        for (const loc of locData.data || []) {
          const setsData = await ascGet(
            `appStoreVersionLocalizations/${loc.id}/appScreenshotSets`,
            { limit: 50 },
            creds,
          );

          for (const set of setsData.data || []) {
            const screenshotsData = await ascGet(
              `appScreenshotSets/${set.id}/appScreenshots`,
              { limit: 10 },
              creds,
            );

            results.push({
              locale: loc.attributes?.locale,
              displayType: set.attributes?.screenshotDisplayType,
              setId: set.id,
              screenshots: (screenshotsData.data || []).map((s: any) => ({
                id: s.id,
                fileName: s.attributes?.fileName,
                fileSize: s.attributes?.fileSize,
                state: s.attributes?.assetDeliveryState?.state,
              })),
            });
          }
        }

        return {
          success: true,
          data: { appId, screenshotSets: results },
          executionTime: Date.now() - startTime,
        };
      }

      if (action === 'upload') {
        if (!screenshotPath || !locale || !displayType) {
          return { success: false, error: 'screenshotPath, locale und displayType sind erforderlich', data: null, executionTime: Date.now() - startTime };
        }

        if (!existsSync(screenshotPath)) {
          return { success: false, error: `Screenshot nicht gefunden: ${screenshotPath}`, data: null, executionTime: Date.now() - startTime };
        }

        const fileSize = statSync(screenshotPath).size;
        const fileName = screenshotPath.split('/').pop() || 'screenshot.png';

        // Find or create the screenshot set
        const versionsData = await ascGet(`apps/${appId}/appStoreVersions`, { limit: 1 }, creds);
        const version = versionsData.data?.[0];
        if (!version) {
          return { success: false, error: 'Keine Version gefunden', data: null, executionTime: Date.now() - startTime };
        }

        const locData = await ascGet(
          `appStoreVersions/${version.id}/appStoreVersionLocalizations`,
          { 'filter[locale]': locale },
          creds,
        );
        const loc = locData.data?.[0];
        if (!loc) {
          return { success: false, error: `Lokalisierung fuer "${locale}" nicht gefunden`, data: null, executionTime: Date.now() - startTime };
        }

        // Find screenshot set for this display type
        const setsData = await ascGet(
          `appStoreVersionLocalizations/${loc.id}/appScreenshotSets`,
          { 'filter[screenshotDisplayType]': displayType },
          creds,
        );

        let setId = setsData.data?.[0]?.id;

        // Create set if not exists
        if (!setId) {
          const newSet = await ascPost('appScreenshotSets', {
            data: {
              type: 'appScreenshotSets',
              attributes: { screenshotDisplayType: displayType },
              relationships: {
                appStoreVersionLocalization: {
                  data: { type: 'appStoreVersionLocalizations', id: loc.id },
                },
              },
            },
          }, creds);
          setId = newSet.data?.id;
        }

        // Reserve screenshot upload
        const reservation = await ascPost('appScreenshots', {
          data: {
            type: 'appScreenshots',
            attributes: { fileName, fileSize },
            relationships: {
              appScreenshotSet: {
                data: { type: 'appScreenshotSets', id: setId },
              },
            },
          },
        }, creds);

        const screenshotData = reservation.data;
        const uploadOps = screenshotData?.attributes?.uploadOperations || [];

        // Upload each part
        for (const op of uploadOps) {
          await execCommand('curl', [
            '-s', '-X', op.method || 'PUT',
            ...op.requestHeaders?.flatMap((h: any) => ['-H', `${h.name}: ${h.value}`]) || [],
            '--data-binary', `@${screenshotPath}`,
            op.url,
          ], { timeout: 120000 });
        }

        // Commit the upload
        await ascPatch(`appScreenshots/${screenshotData.id}`, {
          data: {
            type: 'appScreenshots',
            id: screenshotData.id,
            attributes: {
              uploaded: true,
              sourceFileChecksum: screenshotData.attributes?.sourceFileChecksum,
            },
          },
        }, creds);

        return {
          success: true,
          data: {
            appId,
            locale,
            displayType,
            screenshotId: screenshotData.id,
            fileName,
            message: `Screenshot "${fileName}" erfolgreich hochgeladen`,
          },
          executionTime: Date.now() - startTime,
        };
      }

      if (action === 'delete') {
        if (!screenshotId) {
          return { success: false, error: 'screenshotId ist erforderlich', data: null, executionTime: Date.now() - startTime };
        }

        const { ascDelete } = await import('../utils/asc-api.js');
        await ascDelete(`appScreenshots/${screenshotId}`, creds);

        return {
          success: true,
          data: { screenshotId, message: 'Screenshot erfolgreich geloescht' },
          executionTime: Date.now() - startTime,
        };
      }

      return { success: false, error: `Unbekannte Aktion: ${action}`, data: null, executionTime: Date.now() - startTime };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in manage-screenshots:', error);
      return {
        success: false,
        error: `Fehler bei Screenshot-Operation: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

export const appMetadataTools: ToolDefinition[] = [
  manageAppMetadata,
  manageScreenshots,
];

export default appMetadataTools;
