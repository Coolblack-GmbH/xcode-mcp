import { ToolResult, ToolHandler } from '../types.js';
import { execCommand } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * resolve-pbxproj-conflicts — Automatically resolve merge conflicts in .pbxproj files
 */
const resolvePbxprojConflicts: ToolDefinition = {
  name: 'resolve-pbxproj-conflicts',
  description: 'Automatically resolve merge conflicts in .pbxproj files. Handles the most common case: both sides added different files/references. Keeps both sides ("union merge"). Validates the result and creates a backup.',
  inputSchema: {
    type: 'object',
    properties: {
      pbxprojPath: {
        type: 'string',
        description: 'Path to the project.pbxproj file with merge conflicts',
      },
      strategy: {
        type: 'string',
        enum: ['union', 'ours', 'theirs'],
        description: 'Merge strategy: union (keep both sides, default), ours (keep HEAD), theirs (keep incoming)',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview resolution without writing changes (default: false)',
      },
      backup: {
        type: 'boolean',
        description: 'Create .pbxproj.backup before modifying (default: true)',
      },
    },
    required: ['pbxprojPath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const pbxprojPath = args.pbxprojPath as string;
      const strategy = (args.strategy as string) || 'union';
      const dryRun = (args.dryRun as boolean) || false;
      const backup = args.backup !== false;

      if (!existsSync(pbxprojPath)) {
        return {
          success: false,
          error: `Datei nicht gefunden: ${pbxprojPath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Resolving pbxproj conflicts: ${pbxprojPath} (strategy: ${strategy})`);

      const content = readFileSync(pbxprojPath, 'utf-8');

      // Check if there are actual merge conflicts
      if (!content.includes('<<<<<<<') || !content.includes('=======') || !content.includes('>>>>>>>')) {
        return {
          success: true,
          data: {
            pbxprojPath,
            conflictsFound: 0,
            message: 'Keine Merge-Konflikte in der Datei gefunden',
          },
          executionTime: Date.now() - startTime,
        };
      }

      // Count conflicts
      const conflictMarkers = content.match(/<<<<<<</g) || [];
      const conflictCount = conflictMarkers.length;

      // Resolve conflicts
      let resolved = content;
      const conflictRegex = /<<<<<<< .+?\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> .+?\n/g;

      let resolvedCount = 0;
      let unresolvedCount = 0;

      resolved = content.replace(conflictRegex, (match, ours, theirs) => {
        resolvedCount++;

        switch (strategy) {
          case 'ours':
            return ours;
          case 'theirs':
            return theirs;
          case 'union':
          default:
            // Union merge: combine both sides, removing exact duplicates
            return unionMerge(ours, theirs);
        }
      });

      // Check for remaining conflict markers (nested or malformed)
      if (resolved.includes('<<<<<<<')) {
        unresolvedCount = (resolved.match(/<<<<<<</g) || []).length;
      }

      // Validate basic pbxproj structure
      const validationIssues: string[] = [];

      // Check balanced braces
      const openBraces = (resolved.match(/{/g) || []).length;
      const closeBraces = (resolved.match(/}/g) || []).length;
      if (openBraces !== closeBraces) {
        validationIssues.push(`Unbalancierte Klammern: ${openBraces} oeffnende vs ${closeBraces} schliessende`);
      }

      // Check for duplicate UUIDs in file references
      const uuidPattern = /([0-9A-F]{24})\s*\/\*/g;
      const uuids: Record<string, number> = {};
      let uuidMatch;
      while ((uuidMatch = uuidPattern.exec(resolved)) !== null) {
        const uuid = uuidMatch[1];
        uuids[uuid] = (uuids[uuid] || 0) + 1;
      }
      const duplicateUuids = Object.entries(uuids).filter(([, count]) => count > 2); // > 2 because UUIDs appear in reference and definition
      if (duplicateUuids.length > 0) {
        validationIssues.push(`${duplicateUuids.length} potenziell duplizierte UUID-Referenzen gefunden`);
      }

      // Write result
      if (!dryRun && resolvedCount > 0) {
        if (backup) {
          writeFileSync(`${pbxprojPath}.backup`, content);
        }
        writeFileSync(pbxprojPath, resolved);

        // Verify with plutil
        const plutilResult = await execCommand('plutil', ['-lint', pbxprojPath]);
        if (plutilResult.exitCode !== 0) {
          validationIssues.push(`plutil-Validierung fehlgeschlagen: ${plutilResult.stderr.trim()}`);
          // Restore backup
          if (backup) {
            writeFileSync(pbxprojPath, content);
            validationIssues.push('Originaldatei wiederhergestellt wegen Validierungsfehler');
          }
        }
      }

      return {
        success: unresolvedCount === 0 && validationIssues.length === 0,
        data: {
          pbxprojPath,
          strategy,
          dryRun,
          conflictsFound: conflictCount,
          conflictsResolved: resolvedCount,
          conflictsRemaining: unresolvedCount,
          backupCreated: backup && !dryRun,
          validationIssues: validationIssues.length > 0 ? validationIssues : undefined,
          message: dryRun
            ? `${resolvedCount}/${conflictCount} Konflikte wuerden aufgeloest (Dry-Run)`
            : `${resolvedCount}/${conflictCount} Konflikte aufgeloest`,
        },
        warnings: validationIssues.length > 0 ? validationIssues : undefined,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in resolve-pbxproj-conflicts:', error);
      return {
        success: false,
        error: `Fehler bei der Konflikt-Aufloesung: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Union merge: keep both sides, remove exact duplicate lines
 */
function unionMerge(ours: string, theirs: string): string {
  const oursLines = ours.split('\n');
  const theirsLines = theirs.split('\n');

  // Find lines unique to each side
  const oursSet = new Set(oursLines.map((l) => l.trim()));
  const result: string[] = [...oursLines];

  for (const line of theirsLines) {
    const trimmed = line.trim();
    if (!oursSet.has(trimmed) && trimmed !== '') {
      // Find the best insertion point — after similar surrounding context
      // For pbxproj, additions are usually in sorted sections
      let inserted = false;

      // Try to insert in order (pbxproj sections are often alphabetical)
      for (let i = 0; i < result.length; i++) {
        if (result[i].trim() > trimmed && result[i].trim().startsWith(trimmed.charAt(0))) {
          result.splice(i, 0, line);
          inserted = true;
          break;
        }
      }

      if (!inserted) {
        // Append before the last line (usually a closing delimiter)
        result.splice(result.length - 1, 0, line);
      }
    }
  }

  return result.join('\n');
}

export const pbxprojTools: ToolDefinition[] = [
  resolvePbxprojConflicts,
];

export default pbxprojTools;
