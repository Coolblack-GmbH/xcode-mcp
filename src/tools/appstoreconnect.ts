import { ToolResult, ToolHandler } from '../types.js';
import { execCommand } from '../utils/exec.js';
import { logger } from '../utils/logger.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * query-appstore-connect — Query App Store Connect for build status, TestFlight info, and app metadata
 */
const queryAppStoreConnect: ToolDefinition = {
  name: 'query-appstore-connect',
  description: 'Query App Store Connect for app status, build processing, TestFlight feedback, review status, and version history. Requires the App Store Connect API key or Xcode authentication.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        enum: [
          'apps',
          'builds',
          'testflight-groups',
          'testflight-feedback',
          'app-versions',
          'review-submissions',
          'certificates',
          'devices',
          'profiles',
        ],
        description: 'What to query from App Store Connect',
      },
      appId: {
        type: 'string',
        description: 'App ID or bundle ID to filter results',
      },
      apiKeyPath: {
        type: 'string',
        description: 'Path to App Store Connect API key (.p8 file)',
      },
      apiKeyId: {
        type: 'string',
        description: 'API Key ID (from App Store Connect)',
      },
      issuerId: {
        type: 'string',
        description: 'Issuer ID (from App Store Connect)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 20)',
      },
      platform: {
        type: 'string',
        enum: ['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS'],
        description: 'Filter by platform',
      },
    },
    required: ['query'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const query = args.query as string;
      const appId = args.appId as string | undefined;
      const apiKeyPath = args.apiKeyPath as string | undefined;
      const apiKeyId = args.apiKeyId as string | undefined;
      const issuerId = args.issuerId as string | undefined;
      const limit = (args.limit as number) || 20;
      const platform = args.platform as string | undefined;

      logger.info(`Querying App Store Connect: ${query}`);

      // Check if altool/notarytool/xcrun is available for authentication
      // Try different CLI approaches

      // Approach 1: Use xcrun altool (legacy but widely available)
      // Approach 2: Use App Store Connect API via curl with JWT
      // Approach 3: Use Transporter CLI

      // Build authentication args
      const authArgs: string[] = [];
      if (apiKeyPath && apiKeyId && issuerId) {
        authArgs.push(
          '--apiKey', apiKeyId,
          '--apiIssuer', issuerId,
        );
      }

      let result;

      switch (query) {
        case 'apps': {
          // List all apps using xcrun altool
          result = await execCommand('xcrun', [
            'altool', '--list-apps',
            '--output-format', 'json',
            ...authArgs,
          ], { timeout: 60000 });

          if (result.exitCode === 0) {
            try {
              const data = JSON.parse(result.stdout);
              return {
                success: true,
                data: {
                  query: 'apps',
                  apps: data.applications || data,
                },
                executionTime: Date.now() - startTime,
              };
            } catch {
              return {
                success: true,
                data: { query: 'apps', raw: result.stdout.substring(0, 10000) },
                executionTime: Date.now() - startTime,
              };
            }
          }

          // Fallback: Try App Store Connect API directly
          if (apiKeyPath && apiKeyId && issuerId) {
            return await queryAPI('apps', { limit, platform }, apiKeyId, issuerId, apiKeyPath, startTime);
          }

          return {
            success: false,
            error: buildAuthError(result.stderr),
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        case 'builds': {
          if (apiKeyPath && apiKeyId && issuerId) {
            return await queryAPI(
              appId ? `apps/${appId}/builds` : 'builds',
              { limit, platform, sort: '-uploadedDate' },
              apiKeyId, issuerId, apiKeyPath, startTime,
            );
          }

          // Fallback: altool
          result = await execCommand('xcrun', [
            'altool', '--list-apps',
            '--output-format', 'json',
            ...authArgs,
          ], { timeout: 60000 });

          return {
            success: result.exitCode === 0,
            data: { query: 'builds', raw: result.stdout.substring(0, 10000) },
            error: result.exitCode !== 0 ? buildAuthError(result.stderr) : undefined,
            executionTime: Date.now() - startTime,
          };
        }

        case 'testflight-groups': {
          if (apiKeyPath && apiKeyId && issuerId) {
            return await queryAPI(
              'betaGroups',
              { limit, ...(appId ? { 'filter[app]': appId } : {}) },
              apiKeyId, issuerId, apiKeyPath, startTime,
            );
          }
          return {
            success: false,
            error: 'API-Key erforderlich fuer TestFlight-Abfragen. Bitte apiKeyPath, apiKeyId und issuerId angeben.',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        case 'testflight-feedback': {
          if (apiKeyPath && apiKeyId && issuerId) {
            return await queryAPI(
              'betaAppReviewDetails',
              { limit, ...(appId ? { 'filter[app]': appId } : {}) },
              apiKeyId, issuerId, apiKeyPath, startTime,
            );
          }
          return {
            success: false,
            error: 'API-Key erforderlich fuer TestFlight-Feedback.',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        case 'app-versions': {
          if (apiKeyPath && apiKeyId && issuerId) {
            return await queryAPI(
              appId ? `apps/${appId}/appStoreVersions` : 'appStoreVersions',
              { limit, ...(platform ? { 'filter[platform]': platform } : {}) },
              apiKeyId, issuerId, apiKeyPath, startTime,
            );
          }
          return {
            success: false,
            error: 'API-Key erforderlich fuer Versionsabfragen.',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        case 'review-submissions': {
          if (apiKeyPath && apiKeyId && issuerId) {
            return await queryAPI(
              'reviewSubmissions',
              { limit, ...(appId ? { 'filter[app]': appId } : {}) },
              apiKeyId, issuerId, apiKeyPath, startTime,
            );
          }
          return {
            success: false,
            error: 'API-Key erforderlich fuer Review-Status.',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        case 'certificates': {
          if (apiKeyPath && apiKeyId && issuerId) {
            return await queryAPI('certificates', { limit }, apiKeyId, issuerId, apiKeyPath, startTime);
          }
          return {
            success: false,
            error: 'API-Key erforderlich.',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        case 'devices': {
          if (apiKeyPath && apiKeyId && issuerId) {
            return await queryAPI(
              'devices',
              { limit, ...(platform ? { 'filter[platform]': platform } : {}) },
              apiKeyId, issuerId, apiKeyPath, startTime,
            );
          }
          return {
            success: false,
            error: 'API-Key erforderlich.',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        case 'profiles': {
          if (apiKeyPath && apiKeyId && issuerId) {
            return await queryAPI('profiles', { limit }, apiKeyId, issuerId, apiKeyPath, startTime);
          }
          return {
            success: false,
            error: 'API-Key erforderlich.',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        default:
          return {
            success: false,
            error: `Unbekannte Abfrage: ${query}`,
            data: null,
            executionTime: Date.now() - startTime,
          };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in query-appstore-connect:', error);
      return {
        success: false,
        error: `Fehler bei App Store Connect-Abfrage: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Query App Store Connect API via JWT authentication
 */
async function queryAPI(
  endpoint: string,
  params: Record<string, any>,
  apiKeyId: string,
  issuerId: string,
  apiKeyPath: string,
  startTime: number,
): Promise<ToolResult> {
  try {
    // Generate JWT token using the API key
    // The token generation requires the private key from the .p8 file
    // We use a shell script to create the JWT since Node.js may not have jsonwebtoken installed

    const now = Math.floor(Date.now() / 1000);
    const exp = now + 1200; // 20 minutes

    // Create JWT header and payload
    const header = Buffer.from(JSON.stringify({
      alg: 'ES256',
      kid: apiKeyId,
      typ: 'JWT',
    })).toString('base64url');

    const payload = Buffer.from(JSON.stringify({
      iss: issuerId,
      iat: now,
      exp: exp,
      aud: 'appstoreconnect-v1',
    })).toString('base64url');

    // Sign with openssl
    const signingInput = `${header}.${payload}`;

    const signResult = await execCommand('bash', ['-c',
      `echo -n "${signingInput}" | openssl dgst -sha256 -sign "${apiKeyPath}" | openssl asn1parse -inform DER -out /dev/null 2>/dev/null && echo -n "${signingInput}" | openssl dgst -sha256 -sign "${apiKeyPath}" -binary | base64 | tr '+/' '-_' | tr -d '='`,
    ], { timeout: 10000 });

    if (signResult.exitCode !== 0) {
      return {
        success: false,
        error: `JWT-Signierung fehlgeschlagen: ${signResult.stderr}. Bitte sicherstellen, dass der API-Key (.p8) korrekt ist.`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }

    const signature = signResult.stdout.trim();
    const token = `${signingInput}.${signature}`;

    // Build query parameters
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        queryParams.set(key, String(value));
      }
    }

    const url = `https://api.appstoreconnect.apple.com/v1/${endpoint}?${queryParams.toString()}`;

    const curlResult = await execCommand('curl', [
      '-s', '-X', 'GET',
      '-H', `Authorization: Bearer ${token}`,
      '-H', 'Content-Type: application/json',
      url,
    ], { timeout: 30000 });

    if (curlResult.exitCode !== 0) {
      return {
        success: false,
        error: `API-Anfrage fehlgeschlagen: ${curlResult.stderr}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }

    try {
      const data = JSON.parse(curlResult.stdout);

      if (data.errors) {
        return {
          success: false,
          error: `App Store Connect API Fehler: ${data.errors.map((e: any) => e.detail || e.title).join(', ')}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      return {
        success: true,
        data: {
          query: endpoint,
          results: data.data || [],
          meta: data.meta,
          count: (data.data || []).length,
        },
        executionTime: Date.now() - startTime,
      };
    } catch {
      return {
        success: true,
        data: { query: endpoint, raw: curlResult.stdout.substring(0, 10000) },
        executionTime: Date.now() - startTime,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `API-Fehler: ${error instanceof Error ? error.message : String(error)}`,
      data: null,
      executionTime: Date.now() - startTime,
    };
  }
}

/**
 * Helper: build a helpful auth error message
 */
function buildAuthError(stderr: string): string {
  if (stderr.includes('authentication') || stderr.includes('credentials')) {
    return 'Authentifizierung fehlgeschlagen. Bitte App Store Connect API-Key angeben (apiKeyPath, apiKeyId, issuerId) oder sich in Xcode anmelden.';
  }
  return `Abfrage fehlgeschlagen: ${stderr.substring(0, 500)}`;
}

export const appStoreConnectTools: ToolDefinition[] = [
  queryAppStoreConnect,
];

export default appStoreConnectTools;
