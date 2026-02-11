import { ToolResult, ToolHandler } from '../types.js';
import { execCommand } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { existsSync } from 'fs';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * modify-plist — Read, set, add, or delete values in any .plist file via PlistBuddy
 */
const modifyPlist: ToolDefinition = {
  name: 'modify-plist',
  description: 'Read, set, add, or delete values in any .plist file using PlistBuddy. Supports nested keys via colon-separated paths (e.g. ":CFBundleIcons:CFBundlePrimaryIcon").',
  inputSchema: {
    type: 'object',
    properties: {
      plistPath: {
        type: 'string',
        description: 'Absolute path to the .plist file',
      },
      action: {
        type: 'string',
        enum: ['get', 'set', 'add', 'delete', 'print'],
        description: 'Action to perform: get (read one key), set (update), add (create new), delete (remove), print (dump all)',
      },
      key: {
        type: 'string',
        description: 'Plist key path (e.g. ":CFBundleShortVersionString" or ":NSAppTransportSecurity:NSAllowsArbitraryLoads"). Required for get/set/add/delete.',
      },
      value: {
        type: 'string',
        description: 'Value to set or add. Required for set/add actions.',
      },
      valueType: {
        type: 'string',
        enum: ['string', 'integer', 'real', 'bool', 'date', 'data', 'dict', 'array'],
        description: 'Type of the value for add action (default: string)',
      },
    },
    required: ['plistPath', 'action'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const plistPath = args.plistPath as string;
      const action = args.action as string;
      const key = args.key as string | undefined;
      const value = args.value as string | undefined;
      const valueType = (args.valueType as string) || 'string';

      if (!existsSync(plistPath) && action !== 'add') {
        return {
          success: false,
          error: `Plist-Datei nicht gefunden: ${plistPath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Plist ${action} on ${plistPath}: ${key || 'all'}`);

      let plistBuddyCmd: string;
      switch (action) {
        case 'print':
          plistBuddyCmd = key ? `Print ${key}` : 'Print';
          break;
        case 'get':
          if (!key) {
            return { success: false, error: 'Key ist erforderlich fuer get-Aktion', data: null, executionTime: Date.now() - startTime };
          }
          plistBuddyCmd = `Print ${key}`;
          break;
        case 'set':
          if (!key || value === undefined) {
            return { success: false, error: 'Key und Value sind erforderlich fuer set-Aktion', data: null, executionTime: Date.now() - startTime };
          }
          plistBuddyCmd = `Set ${key} ${value}`;
          break;
        case 'add':
          if (!key || value === undefined) {
            return { success: false, error: 'Key und Value sind erforderlich fuer add-Aktion', data: null, executionTime: Date.now() - startTime };
          }
          plistBuddyCmd = `Add ${key} ${valueType} ${value}`;
          break;
        case 'delete':
          if (!key) {
            return { success: false, error: 'Key ist erforderlich fuer delete-Aktion', data: null, executionTime: Date.now() - startTime };
          }
          plistBuddyCmd = `Delete ${key}`;
          break;
        default:
          return { success: false, error: `Unbekannte Aktion: ${action}`, data: null, executionTime: Date.now() - startTime };
      }

      const result = await execCommand('/usr/libexec/PlistBuddy', ['-c', plistBuddyCmd, plistPath]);

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: `PlistBuddy fehlgeschlagen: ${result.stderr || result.stdout}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      return {
        success: true,
        data: {
          plistPath,
          action,
          key: key || null,
          output: result.stdout.trim(),
          message: action === 'get' || action === 'print'
            ? result.stdout.trim()
            : `${action} erfolgreich auf ${plistPath} ausgefuehrt`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in modify-plist:', error);
      return {
        success: false,
        error: `Fehler bei Plist-Operation: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * manage-entitlements — Manage capabilities in .entitlements files
 */
const manageEntitlements: ToolDefinition = {
  name: 'manage-entitlements',
  description: 'Manage app capabilities (Push Notifications, iCloud, App Groups, Keychain Sharing, etc.) in .entitlements files via PlistBuddy.',
  inputSchema: {
    type: 'object',
    properties: {
      entitlementsPath: {
        type: 'string',
        description: 'Path to the .entitlements file',
      },
      action: {
        type: 'string',
        enum: ['list', 'enable', 'disable'],
        description: 'Action: list (show current), enable (add capability), disable (remove capability)',
      },
      capability: {
        type: 'string',
        enum: [
          'push-notifications',
          'icloud',
          'app-groups',
          'keychain-sharing',
          'associated-domains',
          'healthkit',
          'homekit',
          'siri',
          'apple-pay',
        ],
        description: 'Capability to enable or disable',
      },
      values: {
        type: 'array',
        items: { type: 'string' },
        description: 'Values for the capability (e.g. App Group IDs, Associated Domain entries)',
      },
    },
    required: ['entitlementsPath', 'action'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const entitlementsPath = args.entitlementsPath as string;
      const action = args.action as string;
      const capability = args.capability as string | undefined;
      const values = args.values as string[] | undefined;

      logger.info(`Entitlements ${action} on ${entitlementsPath}: ${capability || 'all'}`);

      // Capability to entitlements key mapping
      const capabilityMap: Record<string, { key: string; type: string; defaultValue: string }> = {
        'push-notifications': { key: ':aps-environment', type: 'string', defaultValue: 'development' },
        'icloud': { key: ':com.apple.developer.icloud-container-identifiers', type: 'array', defaultValue: '' },
        'app-groups': { key: ':com.apple.security.application-groups', type: 'array', defaultValue: '' },
        'keychain-sharing': { key: ':keychain-access-groups', type: 'array', defaultValue: '' },
        'associated-domains': { key: ':com.apple.developer.associated-domains', type: 'array', defaultValue: '' },
        'healthkit': { key: ':com.apple.developer.healthkit', type: 'bool', defaultValue: 'true' },
        'homekit': { key: ':com.apple.developer.homekit', type: 'bool', defaultValue: 'true' },
        'siri': { key: ':com.apple.developer.siri', type: 'bool', defaultValue: 'true' },
        'apple-pay': { key: ':com.apple.developer.in-app-payments', type: 'array', defaultValue: '' },
      };

      if (action === 'list') {
        const result = await execCommand('/usr/libexec/PlistBuddy', ['-c', 'Print', entitlementsPath]);
        return {
          success: result.exitCode === 0,
          data: {
            entitlementsPath,
            entitlements: result.stdout.trim(),
          },
          error: result.exitCode !== 0 ? result.stderr : undefined,
          executionTime: Date.now() - startTime,
        };
      }

      if (!capability) {
        return {
          success: false,
          error: 'Capability ist erforderlich fuer enable/disable-Aktionen',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const capDef = capabilityMap[capability];
      if (!capDef) {
        return {
          success: false,
          error: `Unbekannte Capability: ${capability}. Verfuegbar: ${Object.keys(capabilityMap).join(', ')}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      if (action === 'enable') {
        if (capDef.type === 'array') {
          // Add array key
          await execCommand('/usr/libexec/PlistBuddy', [
            '-c', `Add ${capDef.key} array`, entitlementsPath,
          ]);
          // Add values
          if (values && values.length > 0) {
            for (let i = 0; i < values.length; i++) {
              await execCommand('/usr/libexec/PlistBuddy', [
                '-c', `Add ${capDef.key}:${i} string ${values[i]}`, entitlementsPath,
              ]);
            }
          }
        } else {
          const val = values?.[0] || capDef.defaultValue;
          await execCommand('/usr/libexec/PlistBuddy', [
            '-c', `Add ${capDef.key} ${capDef.type} ${val}`, entitlementsPath,
          ]);
        }

        return {
          success: true,
          data: {
            entitlementsPath,
            capability,
            action: 'enabled',
            values: values || [capDef.defaultValue],
            message: `Capability "${capability}" erfolgreich aktiviert`,
          },
          executionTime: Date.now() - startTime,
        };
      }

      if (action === 'disable') {
        const result = await execCommand('/usr/libexec/PlistBuddy', [
          '-c', `Delete ${capDef.key}`, entitlementsPath,
        ]);

        return {
          success: true,
          data: {
            entitlementsPath,
            capability,
            action: 'disabled',
            message: result.exitCode === 0
              ? `Capability "${capability}" erfolgreich deaktiviert`
              : `Capability "${capability}" war nicht vorhanden`,
          },
          executionTime: Date.now() - startTime,
        };
      }

      return {
        success: false,
        error: `Unbekannte Aktion: ${action}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in manage-entitlements:', error);
      return {
        success: false,
        error: `Fehler bei Entitlements-Operation: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

export const plistTools: ToolDefinition[] = [
  modifyPlist,
  manageEntitlements,
];

export default plistTools;
