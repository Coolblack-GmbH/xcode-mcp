import { ToolResult, ToolHandler } from '../types.js';
import { execCommand } from '../utils/exec.js';
import { ascGet, ascPost, validateASCCredentials } from '../utils/asc-api.js';
import { logger } from '../utils/logger.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * manage-push-certificates — Create, list, and manage APNs keys and push certificates
 */
const managePushCertificates: ToolDefinition = {
  name: 'manage-push-certificates',
  description: 'Manage Apple Push Notification service (APNs) keys and certificates. Create CSR, list existing push certs, validate APNs keys (.p8/.p12), and test push connectivity.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list-keys', 'create-key', 'validate-key', 'create-csr', 'test-push', 'convert-p12'],
        description: 'Action to perform',
      },
      keyPath: {
        type: 'string',
        description: 'Path to APNs key (.p8) or certificate (.p12) file',
      },
      keyId: {
        type: 'string',
        description: 'APNs Key ID (10-char identifier from Apple Developer portal)',
      },
      teamId: {
        type: 'string',
        description: 'Apple Developer Team ID',
      },
      bundleId: {
        type: 'string',
        description: 'App bundle ID for testing push',
      },
      deviceToken: {
        type: 'string',
        description: 'Device token for test push (hex string)',
      },
      p12Password: {
        type: 'string',
        description: 'Password for .p12 file (for convert-p12 action)',
      },
      outputPath: {
        type: 'string',
        description: 'Output path for generated files (CSR, converted PEM)',
      },
      csrEmail: {
        type: 'string',
        description: 'Email address for CSR (for create-csr action)',
      },
      csrName: {
        type: 'string',
        description: 'Common Name for CSR (for create-csr action)',
      },
      environment: {
        type: 'string',
        enum: ['development', 'production'],
        description: 'APNs environment (default: development)',
      },
      apiKeyPath: { type: 'string', description: 'Path to App Store Connect .p8 API key (for list-keys/create-key)' },
      apiKeyId: { type: 'string', description: 'API Key ID' },
      issuerId: { type: 'string', description: 'Issuer ID' },
    },
    required: ['action'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const action = args.action as string;
      const keyPath = args.keyPath as string | undefined;
      const keyId = args.keyId as string | undefined;
      const teamId = args.teamId as string | undefined;
      const bundleId = args.bundleId as string | undefined;
      const deviceToken = args.deviceToken as string | undefined;
      const p12Password = args.p12Password as string | undefined;
      const outputPath = args.outputPath as string | undefined;
      const csrEmail = args.csrEmail as string | undefined;
      const csrName = args.csrName as string | undefined;
      const environment = (args.environment as string) || 'development';

      logger.info(`Push certificates ${action}`);

      // LIST-KEYS — list APNs keys via App Store Connect API
      if (action === 'list-keys') {
        const credsResult = validateASCCredentials(
          args.apiKeyPath as string,
          args.apiKeyId as string,
          args.issuerId as string,
        );
        if (typeof credsResult === 'string') {
          // Fallback: list local certificates
          const certResult = await execCommand('security', [
            'find-identity', '-v', '-p', 'appleID',
          ]);

          const pushCerts = certResult.stdout.split('\n')
            .filter((l) => l.includes('Push') || l.includes('APN'))
            .map((l) => l.trim());

          return {
            success: true,
            data: {
              source: 'keychain',
              certificates: pushCerts,
              count: pushCerts.length,
              note: 'Fuer vollstaendige API-Key-Liste bitte ASC-Credentials angeben',
            },
            executionTime: Date.now() - startTime,
          };
        }

        const data = await ascGet('certificates', {
          'filter[certificateType]': 'APPLE_PUSH_SERVICES_CERT,APPLE_PUSH_SERVICES_CERT_DEVELOPMENT',
          limit: 50,
        }, credsResult);

        return {
          success: true,
          data: {
            source: 'appstoreconnect',
            certificates: (data.data || []).map((cert: any) => ({
              id: cert.id,
              name: cert.attributes?.name,
              type: cert.attributes?.certificateType,
              expirationDate: cert.attributes?.expirationDate,
              platform: cert.attributes?.platform,
            })),
          },
          executionTime: Date.now() - startTime,
        };
      }

      // CREATE-KEY — create a new APNs key via ASC API
      if (action === 'create-key') {
        const credsResult = validateASCCredentials(
          args.apiKeyPath as string,
          args.apiKeyId as string,
          args.issuerId as string,
        );
        if (typeof credsResult === 'string') {
          return { success: false, error: credsResult, data: null, executionTime: Date.now() - startTime };
        }

        const keyData = await ascPost('keys', {
          data: {
            type: 'keys',
            attributes: {
              name: `APNs Key ${new Date().toISOString().slice(0, 10)}`,
              allAppsVisible: true,
              roles: ['PUSH_NOTIFICATIONS'],
            },
          },
        }, credsResult);

        return {
          success: true,
          data: {
            keyId: keyData.data?.id,
            name: keyData.data?.attributes?.name,
            message: 'APNs-Key erfolgreich erstellt. Bitte den privaten Schluessel sofort herunterladen — er kann nur einmal abgerufen werden.',
          },
          executionTime: Date.now() - startTime,
        };
      }

      // VALIDATE-KEY — check if an APNs key is valid
      if (action === 'validate-key') {
        if (!keyPath) {
          return { success: false, error: 'keyPath ist erforderlich', data: null, executionTime: Date.now() - startTime };
        }

        if (!existsSync(keyPath)) {
          return { success: false, error: `Key-Datei nicht gefunden: ${keyPath}`, data: null, executionTime: Date.now() - startTime };
        }

        const isP8 = keyPath.endsWith('.p8');
        const isP12 = keyPath.endsWith('.p12');

        if (isP8) {
          // Validate P8 key structure
          const content = readFileSync(keyPath, 'utf-8');
          const hasHeader = content.includes('BEGIN PRIVATE KEY');
          const hasFooter = content.includes('END PRIVATE KEY');

          // Try to read key with openssl
          const opensslResult = await execCommand('openssl', ['ec', '-in', keyPath, '-text', '-noout']);

          return {
            success: true,
            data: {
              keyPath,
              format: 'p8',
              valid: hasHeader && hasFooter && opensslResult.exitCode === 0,
              keyType: opensslResult.exitCode === 0 ? 'EC (P-256)' : 'unknown',
              issues: [
                ...(!hasHeader ? ['Fehlender BEGIN PRIVATE KEY Header'] : []),
                ...(!hasFooter ? ['Fehlender END PRIVATE KEY Footer'] : []),
                ...(opensslResult.exitCode !== 0 ? [`OpenSSL-Fehler: ${opensslResult.stderr.trim()}`] : []),
              ],
            },
            executionTime: Date.now() - startTime,
          };
        }

        if (isP12) {
          const verifyArgs = ['pkcs12', '-info', '-in', keyPath, '-nokeys', '-noout'];
          if (p12Password) {
            verifyArgs.push('-passin', `pass:${p12Password}`);
          } else {
            verifyArgs.push('-passin', 'pass:');
          }

          const result = await execCommand('openssl', verifyArgs);

          return {
            success: true,
            data: {
              keyPath,
              format: 'p12',
              valid: result.exitCode === 0,
              issues: result.exitCode !== 0 ? [result.stderr.trim()] : [],
            },
            executionTime: Date.now() - startTime,
          };
        }

        return { success: false, error: 'Datei muss .p8 oder .p12 sein', data: null, executionTime: Date.now() - startTime };
      }

      // CREATE-CSR — generate a Certificate Signing Request
      if (action === 'create-csr') {
        const email = csrEmail || 'dev@example.com';
        const name = csrName || 'Apple Push Services';
        const outDir = outputPath || '.';
        const keyFile = join(outDir, 'push_key.pem');
        const csrFile = join(outDir, 'push_csr.certSigningRequest');

        // Generate private key
        const keyResult = await execCommand('openssl', [
          'genrsa', '-out', keyFile, '2048',
        ]);

        if (keyResult.exitCode !== 0) {
          return { success: false, error: `Schluesselgenerierung fehlgeschlagen: ${keyResult.stderr}`, data: null, executionTime: Date.now() - startTime };
        }

        // Generate CSR
        const csrResult = await execCommand('openssl', [
          'req', '-new', '-key', keyFile, '-out', csrFile,
          '-subj', `/emailAddress=${email}/CN=${name}/C=DE`,
        ]);

        if (csrResult.exitCode !== 0) {
          return { success: false, error: `CSR-Erstellung fehlgeschlagen: ${csrResult.stderr}`, data: null, executionTime: Date.now() - startTime };
        }

        return {
          success: true,
          data: {
            privateKeyPath: keyFile,
            csrPath: csrFile,
            email,
            commonName: name,
            message: `CSR erstellt. Bitte ${csrFile} im Apple Developer Portal hochladen, um ein Push-Zertifikat zu erhalten.`,
          },
          executionTime: Date.now() - startTime,
        };
      }

      // TEST-PUSH — send a test push notification via APNs
      if (action === 'test-push') {
        if (!keyPath || !keyId || !teamId || !bundleId || !deviceToken) {
          return {
            success: false,
            error: 'keyPath, keyId, teamId, bundleId und deviceToken sind alle erforderlich fuer test-push',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        const apnsHost = environment === 'production'
          ? 'api.push.apple.com'
          : 'api.sandbox.push.apple.com';

        if (keyPath.endsWith('.p8')) {
          // JWT-based auth for .p8 keys
          const now = Math.floor(Date.now() / 1000);
          const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })).toString('base64url');
          const payload = Buffer.from(JSON.stringify({ iss: teamId, iat: now })).toString('base64url');
          const signingInput = `${header}.${payload}`;

          const signResult = await execCommand('bash', ['-c',
            `echo -n "${signingInput}" | openssl dgst -sha256 -sign "${keyPath}" -binary | base64 | tr '+/' '-_' | tr -d '='`,
          ]);

          if (signResult.exitCode !== 0) {
            return { success: false, error: `JWT-Signierung fehlgeschlagen: ${signResult.stderr}`, data: null, executionTime: Date.now() - startTime };
          }

          const token = `${signingInput}.${signResult.stdout.trim()}`;
          const pushPayload = JSON.stringify({
            aps: {
              alert: { title: 'Test Push', body: 'xcode-mcp Push-Test erfolgreich!' },
              sound: 'default',
            },
          });

          const pushResult = await execCommand('curl', [
            '-s', '-v',
            '--http2',
            '-H', `authorization: bearer ${token}`,
            '-H', `apns-topic: ${bundleId}`,
            '-H', 'apns-push-type: alert',
            '-d', pushPayload,
            `https://${apnsHost}/3/device/${deviceToken}`,
          ], { timeout: 30000 });

          const success = pushResult.exitCode === 0 &&
            !pushResult.stdout.includes('"reason"');

          return {
            success,
            data: {
              environment,
              apnsHost,
              bundleId,
              deviceToken: `${deviceToken.substring(0, 8)}...`,
              response: pushResult.stdout.trim() || 'OK (kein Body = Erfolg)',
              httpStatus: pushResult.stderr.match(/< HTTP\/2 (\d+)/)?.[1] || 'unknown',
            },
            error: !success ? pushResult.stdout.trim() : undefined,
            executionTime: Date.now() - startTime,
          };
        }

        return { success: false, error: 'Nur .p8 Keys werden fuer test-push unterstuetzt', data: null, executionTime: Date.now() - startTime };
      }

      // CONVERT-P12 — convert .p12 to PEM
      if (action === 'convert-p12') {
        if (!keyPath) {
          return { success: false, error: 'keyPath ist erforderlich', data: null, executionTime: Date.now() - startTime };
        }

        const outFile = outputPath || keyPath.replace('.p12', '.pem');
        const convertArgs = [
          'pkcs12', '-in', keyPath, '-out', outFile, '-nodes',
        ];
        if (p12Password) {
          convertArgs.push('-passin', `pass:${p12Password}`);
        } else {
          convertArgs.push('-passin', 'pass:');
        }

        const result = await execCommand('openssl', convertArgs);

        return {
          success: result.exitCode === 0,
          data: {
            inputPath: keyPath,
            outputPath: outFile,
            format: 'PEM',
            message: result.exitCode === 0
              ? `Erfolgreich konvertiert: ${outFile}`
              : undefined,
          },
          error: result.exitCode !== 0 ? `Konvertierung fehlgeschlagen: ${result.stderr}` : undefined,
          executionTime: Date.now() - startTime,
        };
      }

      return { success: false, error: `Unbekannte Aktion: ${action}`, data: null, executionTime: Date.now() - startTime };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in manage-push-certificates:', error);
      return {
        success: false,
        error: `Fehler bei Push-Zertifikat-Operation: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

export const pushCertTools: ToolDefinition[] = [
  managePushCertificates,
];

export default pushCertTools;
