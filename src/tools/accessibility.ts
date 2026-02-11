import { ToolResult, ToolHandler } from '../types.js';
import { execSimctl, execCommand } from '../utils/exec.js';
import { logger } from '../utils/logger.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * audit-accessibility — Run accessibility audit on a running simulator app
 */
const auditAccessibility: ToolDefinition = {
  name: 'audit-accessibility',
  description: 'Run an automated accessibility audit on a running app in the iOS Simulator. Reports missing labels, insufficient contrast, touch target sizes, and other a11y issues. Uses simctl accessibility.',
  inputSchema: {
    type: 'object',
    properties: {
      simulatorUdid: {
        type: 'string',
        description: 'UDID of the booted simulator. If not provided, uses first booted simulator.',
      },
      bundleId: {
        type: 'string',
        description: 'Bundle ID of the app to audit (optional — audits the frontmost app if omitted)',
      },
      auditType: {
        type: 'string',
        enum: ['full', 'labels', 'contrast', 'touch-targets', 'traits'],
        description: 'Type of audit to run (default: full)',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      let simulatorUdid = args.simulatorUdid as string | undefined;
      const bundleId = args.bundleId as string | undefined;
      const auditType = (args.auditType as string) || 'full';

      logger.info(`Running accessibility audit (${auditType})`);

      // Find booted simulator if not specified
      if (!simulatorUdid) {
        const listResult = await execSimctl(['list', 'devices', 'booted', '-j']);
        if (listResult.exitCode === 0) {
          try {
            const data = JSON.parse(listResult.stdout);
            for (const runtime of Object.values(data.devices) as any[]) {
              if (Array.isArray(runtime)) {
                const booted = runtime.find((d: any) => d.state === 'Booted');
                if (booted) {
                  simulatorUdid = booted.udid;
                  break;
                }
              }
            }
          } catch {
            // parse failed
          }
        }

        if (!simulatorUdid) {
          return {
            success: false,
            error: 'Kein gestarteter Simulator gefunden. Bitte simulatorUdid angeben oder einen Simulator starten.',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }
      }

      // Try simctl accessibility audit (Xcode 15+)
      const auditResult = await execSimctl([
        'accessibility', simulatorUdid, 'audit',
      ], { timeout: 60000 });

      let auditData: any;

      if (auditResult.exitCode === 0) {
        // Parse audit results
        const output = auditResult.stdout;
        const issues: Array<{
          type: string;
          severity: string;
          element: string;
          description: string;
          suggestion: string;
        }> = [];

        // Parse structured output — format varies by Xcode version
        const lines = output.split('\n');
        let currentIssue: any = null;

        for (const line of lines) {
          if (line.includes('Warning:') || line.includes('Error:') || line.includes('Issue:')) {
            if (currentIssue) issues.push(currentIssue);
            const severity = line.includes('Error:') ? 'error' : 'warning';
            currentIssue = {
              type: 'accessibility',
              severity,
              element: '',
              description: line.replace(/^(Warning|Error|Issue):\s*/, '').trim(),
              suggestion: '',
            };
          } else if (currentIssue && line.includes('Element:')) {
            currentIssue.element = line.replace('Element:', '').trim();
          } else if (currentIssue && line.includes('Suggestion:')) {
            currentIssue.suggestion = line.replace('Suggestion:', '').trim();
          }
        }
        if (currentIssue) issues.push(currentIssue);

        // Filter by audit type
        const filtered = auditType === 'full' ? issues : issues.filter((i) => {
          const desc = i.description.toLowerCase();
          switch (auditType) {
            case 'labels': return desc.includes('label') || desc.includes('accessibility');
            case 'contrast': return desc.includes('contrast') || desc.includes('color');
            case 'touch-targets': return desc.includes('touch') || desc.includes('target') || desc.includes('size');
            case 'traits': return desc.includes('trait') || desc.includes('role');
            default: return true;
          }
        });

        auditData = {
          simulatorUdid,
          bundleId: bundleId || 'frontmost app',
          auditType,
          totalIssues: filtered.length,
          errors: filtered.filter((i) => i.severity === 'error').length,
          warnings: filtered.filter((i) => i.severity === 'warning').length,
          issues: filtered,
          rawOutput: output.substring(0, 10000),
        };
      } else {
        // Fallback: Dump accessibility tree and analyze manually
        logger.warn('simctl accessibility audit nicht verfuegbar, verwende Fallback');

        const dumpArgs = ['accessibility', simulatorUdid, 'dump'];
        const dumpResult = await execSimctl(dumpArgs, { timeout: 30000 });

        if (dumpResult.exitCode !== 0) {
          return {
            success: false,
            error: `Accessibility-Audit fehlgeschlagen: ${auditResult.stderr}\nFallback-Dump: ${dumpResult.stderr}`,
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        // Analyze the accessibility tree dump for common issues
        const tree = dumpResult.stdout;
        const issues: Array<{ type: string; description: string; severity: string }> = [];

        // Check for missing labels
        const missingLabels = (tree.match(/label:\s*""/g) || []).length;
        if (missingLabels > 0) {
          issues.push({
            type: 'missing-label',
            description: `${missingLabels} Element(e) ohne Accessibility-Label gefunden`,
            severity: 'error',
          });
        }

        // Check for missing traits
        const noTraits = (tree.match(/traits:\s*\(\s*\)/g) || []).length;
        if (noTraits > 0) {
          issues.push({
            type: 'missing-traits',
            description: `${noTraits} Element(e) ohne Accessibility-Traits gefunden`,
            severity: 'warning',
          });
        }

        auditData = {
          simulatorUdid,
          bundleId: bundleId || 'frontmost app',
          auditType,
          method: 'tree-analysis',
          totalIssues: issues.length,
          issues,
          treePreview: tree.substring(0, 5000),
        };
      }

      return {
        success: true,
        data: auditData,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in audit-accessibility:', error);
      return {
        success: false,
        error: `Fehler beim Accessibility-Audit: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

export const accessibilityTools: ToolDefinition[] = [
  auditAccessibility,
];

export default accessibilityTools;
