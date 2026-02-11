import { ToolResult, ToolHandler } from '../types.js';
import { execCommand } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * manage-privacy-manifest — Create, read, or edit PrivacyInfo.xcprivacy files
 */
const managePrivacyManifest: ToolDefinition = {
  name: 'manage-privacy-manifest',
  description: 'Create, read, or edit Privacy Manifest (PrivacyInfo.xcprivacy) files. Manage API declarations, tracking domains, and collected data types required by Apple.',
  inputSchema: {
    type: 'object',
    properties: {
      manifestPath: {
        type: 'string',
        description: 'Path to PrivacyInfo.xcprivacy file',
      },
      action: {
        type: 'string',
        enum: ['read', 'create', 'add-api', 'add-tracking-domain', 'add-collected-data', 'set-tracking'],
        description: 'Action to perform',
      },
      apiType: {
        type: 'string',
        enum: [
          'NSPrivacyAccessedAPICategoryFileTimestamp',
          'NSPrivacyAccessedAPICategorySystemBootTime',
          'NSPrivacyAccessedAPICategoryDiskSpace',
          'NSPrivacyAccessedAPICategoryActiveKeyboards',
          'NSPrivacyAccessedAPICategoryUserDefaults',
        ],
        description: 'Required API type category (for add-api action)',
      },
      apiReasons: {
        type: 'array',
        items: { type: 'string' },
        description: 'Reason codes for the API usage (e.g. ["CA92.1", "C617.1"])',
      },
      trackingDomains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tracking domains to declare (for add-tracking-domain action)',
      },
      collectedDataType: {
        type: 'string',
        description: 'Data type being collected (for add-collected-data action)',
      },
      collectedDataPurposes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Purposes for data collection',
      },
      collectedDataLinked: {
        type: 'boolean',
        description: 'Whether data is linked to user identity (default: false)',
      },
      trackingEnabled: {
        type: 'boolean',
        description: 'Whether app uses tracking (for set-tracking action)',
      },
    },
    required: ['manifestPath', 'action'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const manifestPath = args.manifestPath as string;
      const action = args.action as string;

      logger.info(`Privacy manifest ${action} on ${manifestPath}`);

      // READ action
      if (action === 'read') {
        if (!existsSync(manifestPath)) {
          return {
            success: false,
            error: `Privacy Manifest nicht gefunden: ${manifestPath}`,
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        const result = await execCommand('/usr/libexec/PlistBuddy', ['-c', 'Print', manifestPath]);
        return {
          success: true,
          data: {
            manifestPath,
            content: result.stdout.trim(),
          },
          executionTime: Date.now() - startTime,
        };
      }

      // CREATE action — generate a minimal PrivacyInfo.xcprivacy
      if (action === 'create') {
        const minimalManifest = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>NSPrivacyTracking</key>
\t<false/>
\t<key>NSPrivacyTrackingDomains</key>
\t<array/>
\t<key>NSPrivacyCollectedDataTypes</key>
\t<array/>
\t<key>NSPrivacyAccessedAPITypes</key>
\t<array/>
</dict>
</plist>
`;
        writeFileSync(manifestPath, minimalManifest, 'utf-8');

        return {
          success: true,
          data: {
            manifestPath,
            message: 'Privacy Manifest erfolgreich erstellt',
          },
          executionTime: Date.now() - startTime,
        };
      }

      // Remaining actions require an existing file
      if (!existsSync(manifestPath)) {
        return {
          success: false,
          error: `Privacy Manifest nicht gefunden: ${manifestPath}. Bitte zuerst mit action=create erstellen.`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // ADD-API action
      if (action === 'add-api') {
        const apiType = args.apiType as string;
        const apiReasons = args.apiReasons as string[] | undefined;

        if (!apiType) {
          return {
            success: false,
            error: 'apiType ist erforderlich fuer add-api',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        // Find next index in the NSPrivacyAccessedAPITypes array
        const countResult = await execCommand('/usr/libexec/PlistBuddy', [
          '-c', 'Print :NSPrivacyAccessedAPITypes',
          manifestPath,
        ]);

        let index = 0;
        if (countResult.exitCode === 0) {
          const matches = countResult.stdout.match(/Dict/g);
          index = matches ? matches.length : 0;
        }

        // Add new API type entry
        await execCommand('/usr/libexec/PlistBuddy', [
          '-c', `Add :NSPrivacyAccessedAPITypes:${index} dict`,
          manifestPath,
        ]);
        await execCommand('/usr/libexec/PlistBuddy', [
          '-c', `Add :NSPrivacyAccessedAPITypes:${index}:NSPrivacyAccessedAPIType string ${apiType}`,
          manifestPath,
        ]);
        await execCommand('/usr/libexec/PlistBuddy', [
          '-c', `Add :NSPrivacyAccessedAPITypes:${index}:NSPrivacyAccessedAPITypeReasons array`,
          manifestPath,
        ]);

        if (apiReasons) {
          for (let i = 0; i < apiReasons.length; i++) {
            await execCommand('/usr/libexec/PlistBuddy', [
              '-c', `Add :NSPrivacyAccessedAPITypes:${index}:NSPrivacyAccessedAPITypeReasons:${i} string ${apiReasons[i]}`,
              manifestPath,
            ]);
          }
        }

        return {
          success: true,
          data: {
            manifestPath,
            apiType,
            apiReasons,
            message: `API-Typ "${apiType}" erfolgreich hinzugefuegt`,
          },
          executionTime: Date.now() - startTime,
        };
      }

      // ADD-TRACKING-DOMAIN action
      if (action === 'add-tracking-domain') {
        const domains = args.trackingDomains as string[];
        if (!domains || domains.length === 0) {
          return {
            success: false,
            error: 'trackingDomains ist erforderlich',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        const countResult = await execCommand('/usr/libexec/PlistBuddy', [
          '-c', 'Print :NSPrivacyTrackingDomains',
          manifestPath,
        ]);

        let startIndex = 0;
        if (countResult.exitCode === 0) {
          const matches = countResult.stdout.match(/\S+/g);
          startIndex = matches ? matches.filter((m) => !m.includes('Array') && !m.includes('{')).length : 0;
        }

        for (let i = 0; i < domains.length; i++) {
          await execCommand('/usr/libexec/PlistBuddy', [
            '-c', `Add :NSPrivacyTrackingDomains:${startIndex + i} string ${domains[i]}`,
            manifestPath,
          ]);
        }

        return {
          success: true,
          data: {
            manifestPath,
            addedDomains: domains,
            message: `${domains.length} Tracking-Domain(s) hinzugefuegt`,
          },
          executionTime: Date.now() - startTime,
        };
      }

      // ADD-COLLECTED-DATA action
      if (action === 'add-collected-data') {
        const dataType = args.collectedDataType as string;
        const purposes = args.collectedDataPurposes as string[] | undefined;
        const linked = (args.collectedDataLinked as boolean) || false;

        if (!dataType) {
          return {
            success: false,
            error: 'collectedDataType ist erforderlich',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        const countResult = await execCommand('/usr/libexec/PlistBuddy', [
          '-c', 'Print :NSPrivacyCollectedDataTypes',
          manifestPath,
        ]);

        let index = 0;
        if (countResult.exitCode === 0) {
          const matches = countResult.stdout.match(/Dict/g);
          index = matches ? matches.length : 0;
        }

        await execCommand('/usr/libexec/PlistBuddy', [
          '-c', `Add :NSPrivacyCollectedDataTypes:${index} dict`,
          manifestPath,
        ]);
        await execCommand('/usr/libexec/PlistBuddy', [
          '-c', `Add :NSPrivacyCollectedDataTypes:${index}:NSPrivacyCollectedDataType string ${dataType}`,
          manifestPath,
        ]);
        await execCommand('/usr/libexec/PlistBuddy', [
          '-c', `Add :NSPrivacyCollectedDataTypes:${index}:NSPrivacyCollectedDataTypeLinked bool ${linked}`,
          manifestPath,
        ]);
        await execCommand('/usr/libexec/PlistBuddy', [
          '-c', `Add :NSPrivacyCollectedDataTypes:${index}:NSPrivacyCollectedDataTypeTracking bool false`,
          manifestPath,
        ]);

        if (purposes) {
          await execCommand('/usr/libexec/PlistBuddy', [
            '-c', `Add :NSPrivacyCollectedDataTypes:${index}:NSPrivacyCollectedDataTypePurposes array`,
            manifestPath,
          ]);
          for (let i = 0; i < purposes.length; i++) {
            await execCommand('/usr/libexec/PlistBuddy', [
              '-c', `Add :NSPrivacyCollectedDataTypes:${index}:NSPrivacyCollectedDataTypePurposes:${i} string ${purposes[i]}`,
              manifestPath,
            ]);
          }
        }

        return {
          success: true,
          data: {
            manifestPath,
            dataType,
            linked,
            purposes,
            message: `Collected Data Type "${dataType}" hinzugefuegt`,
          },
          executionTime: Date.now() - startTime,
        };
      }

      // SET-TRACKING action
      if (action === 'set-tracking') {
        const tracking = (args.trackingEnabled as boolean) || false;

        await execCommand('/usr/libexec/PlistBuddy', [
          '-c', `Set :NSPrivacyTracking ${tracking}`,
          manifestPath,
        ]);

        return {
          success: true,
          data: {
            manifestPath,
            trackingEnabled: tracking,
            message: `Tracking auf ${tracking} gesetzt`,
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
      logger.error('Error in manage-privacy-manifest:', error);
      return {
        success: false,
        error: `Fehler bei Privacy-Manifest-Operation: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

export const privacyTools: ToolDefinition[] = [
  managePrivacyManifest,
];

export default privacyTools;
