import { execCommand } from './exec.js';
import { logger } from './logger.js';

/**
 * App Store Connect API authentication credentials
 */
export interface ASCCredentials {
  apiKeyId: string;
  issuerId: string;
  apiKeyPath: string;
}

/**
 * Generate a JWT token for App Store Connect API
 */
export async function generateASCToken(creds: ASCCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 1200; // 20 minutes

  const header = Buffer.from(JSON.stringify({
    alg: 'ES256',
    kid: creds.apiKeyId,
    typ: 'JWT',
  })).toString('base64url');

  const payload = Buffer.from(JSON.stringify({
    iss: creds.issuerId,
    iat: now,
    exp,
    aud: 'appstoreconnect-v1',
  })).toString('base64url');

  const signingInput = `${header}.${payload}`;

  const signResult = await execCommand('bash', ['-c',
    `echo -n "${signingInput}" | openssl dgst -sha256 -sign "${creds.apiKeyPath}" -binary | base64 | tr '+/' '-_' | tr -d '='`,
  ], { timeout: 10000 });

  if (signResult.exitCode !== 0) {
    throw new Error(`JWT-Signierung fehlgeschlagen: ${signResult.stderr}`);
  }

  return `${signingInput}.${signResult.stdout.trim()}`;
}

/**
 * Make a GET request to the App Store Connect API
 */
export async function ascGet(
  endpoint: string,
  params: Record<string, any>,
  creds: ASCCredentials,
): Promise<any> {
  const token = await generateASCToken(creds);

  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      queryParams.set(key, String(value));
    }
  }

  const url = `https://api.appstoreconnect.apple.com/v1/${endpoint}?${queryParams.toString()}`;

  const result = await execCommand('curl', [
    '-s', '-X', 'GET',
    '-H', `Authorization: Bearer ${token}`,
    '-H', 'Content-Type: application/json',
    url,
  ], { timeout: 30000 });

  if (result.exitCode !== 0) {
    throw new Error(`API-Anfrage fehlgeschlagen: ${result.stderr}`);
  }

  const data = JSON.parse(result.stdout);
  if (data.errors) {
    throw new Error(data.errors.map((e: any) => e.detail || e.title).join(', '));
  }

  return data;
}

/**
 * Make a POST request to the App Store Connect API
 */
export async function ascPost(
  endpoint: string,
  body: any,
  creds: ASCCredentials,
): Promise<any> {
  const token = await generateASCToken(creds);
  const url = `https://api.appstoreconnect.apple.com/v1/${endpoint}`;

  const result = await execCommand('curl', [
    '-s', '-X', 'POST',
    '-H', `Authorization: Bearer ${token}`,
    '-H', 'Content-Type: application/json',
    '-d', JSON.stringify(body),
    url,
  ], { timeout: 30000 });

  if (result.exitCode !== 0) {
    throw new Error(`API-POST fehlgeschlagen: ${result.stderr}`);
  }

  const data = JSON.parse(result.stdout);
  if (data.errors) {
    throw new Error(data.errors.map((e: any) => e.detail || e.title).join(', '));
  }

  return data;
}

/**
 * Make a PATCH request to the App Store Connect API
 */
export async function ascPatch(
  endpoint: string,
  body: any,
  creds: ASCCredentials,
): Promise<any> {
  const token = await generateASCToken(creds);
  const url = `https://api.appstoreconnect.apple.com/v1/${endpoint}`;

  const result = await execCommand('curl', [
    '-s', '-X', 'PATCH',
    '-H', `Authorization: Bearer ${token}`,
    '-H', 'Content-Type: application/json',
    '-d', JSON.stringify(body),
    url,
  ], { timeout: 30000 });

  if (result.exitCode !== 0) {
    throw new Error(`API-PATCH fehlgeschlagen: ${result.stderr}`);
  }

  const data = JSON.parse(result.stdout);
  if (data.errors) {
    throw new Error(data.errors.map((e: any) => e.detail || e.title).join(', '));
  }

  return data;
}

/**
 * Make a DELETE request to the App Store Connect API
 */
export async function ascDelete(
  endpoint: string,
  creds: ASCCredentials,
): Promise<void> {
  const token = await generateASCToken(creds);
  const url = `https://api.appstoreconnect.apple.com/v1/${endpoint}`;

  const result = await execCommand('curl', [
    '-s', '-X', 'DELETE',
    '-H', `Authorization: Bearer ${token}`,
    '-H', 'Content-Type: application/json',
    url,
  ], { timeout: 30000 });

  if (result.exitCode !== 0) {
    throw new Error(`API-DELETE fehlgeschlagen: ${result.stderr}`);
  }
}

/**
 * Upload a file (e.g. screenshot) to App Store Connect
 * Uses the upload operations pattern from ASC API
 */
export async function ascUploadAsset(
  uploadUrl: string,
  filePath: string,
  creds: ASCCredentials,
): Promise<any> {
  const token = await generateASCToken(creds);

  const result = await execCommand('curl', [
    '-s', '-X', 'PUT',
    '-H', `Authorization: Bearer ${token}`,
    '-H', 'Content-Type: application/octet-stream',
    '--data-binary', `@${filePath}`,
    uploadUrl,
  ], { timeout: 120000 });

  if (result.exitCode !== 0) {
    throw new Error(`Upload fehlgeschlagen: ${result.stderr}`);
  }

  return result.stdout ? JSON.parse(result.stdout) : {};
}

/**
 * Validate that ASC credentials are present, return error message if not
 */
export function validateASCCredentials(
  apiKeyPath?: string,
  apiKeyId?: string,
  issuerId?: string,
): ASCCredentials | string {
  if (!apiKeyPath || !apiKeyId || !issuerId) {
    return 'App Store Connect API-Key erforderlich. Bitte apiKeyPath (.p8), apiKeyId und issuerId angeben.';
  }
  return { apiKeyPath, apiKeyId, issuerId };
}
