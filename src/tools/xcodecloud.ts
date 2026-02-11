import { ToolResult, ToolHandler } from '../types.js';
import { ascGet, ascPost, ascPatch, ascDelete, validateASCCredentials } from '../utils/asc-api.js';
import { logger } from '../utils/logger.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * manage-xcode-cloud — Manage Xcode Cloud CI/CD workflows
 */
const manageXcodeCloud: ToolDefinition = {
  name: 'manage-xcode-cloud',
  description: 'Manage Xcode Cloud CI/CD workflows: list workflows, start builds, check build status, view build logs, and manage artifacts. Requires App Store Connect API key.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'list-products',
          'list-workflows',
          'start-build',
          'list-builds',
          'get-build',
          'cancel-build',
          'list-artifacts',
          'get-logs',
        ],
        description: 'Action to perform',
      },
      productId: {
        type: 'string',
        description: 'Xcode Cloud Product ID (CI product linked to your app)',
      },
      workflowId: {
        type: 'string',
        description: 'Workflow ID (for start-build, list-builds)',
      },
      buildId: {
        type: 'string',
        description: 'Build Run ID (for get-build, cancel-build, list-artifacts, get-logs)',
      },
      gitReference: {
        type: 'string',
        description: 'Git branch or tag name to build (for start-build, default: main)',
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (default: 20)',
      },
      apiKeyPath: { type: 'string', description: 'Path to .p8 API key' },
      apiKeyId: { type: 'string', description: 'API Key ID' },
      issuerId: { type: 'string', description: 'Issuer ID' },
    },
    required: ['action', 'apiKeyPath', 'apiKeyId', 'issuerId'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const action = args.action as string;
      const productId = args.productId as string | undefined;
      const workflowId = args.workflowId as string | undefined;
      const buildId = args.buildId as string | undefined;
      const gitReference = (args.gitReference as string) || 'main';
      const limit = (args.limit as number) || 20;

      const credsResult = validateASCCredentials(
        args.apiKeyPath as string,
        args.apiKeyId as string,
        args.issuerId as string,
      );
      if (typeof credsResult === 'string') {
        return { success: false, error: credsResult, data: null, executionTime: Date.now() - startTime };
      }
      const creds = credsResult;

      logger.info(`Xcode Cloud ${action}`);

      switch (action) {
        // LIST-PRODUCTS — list all Xcode Cloud CI products
        case 'list-products': {
          const data = await ascGet('ciProducts', {
            limit,
            include: 'app',
          }, creds);

          return {
            success: true,
            data: {
              products: (data.data || []).map((p: any) => ({
                id: p.id,
                name: p.attributes?.name,
                productType: p.attributes?.productType,
                createdDate: p.attributes?.createdDate,
              })),
              count: (data.data || []).length,
            },
            executionTime: Date.now() - startTime,
          };
        }

        // LIST-WORKFLOWS — list workflows for a product
        case 'list-workflows': {
          let endpoint = 'ciWorkflows';
          const params: Record<string, any> = { limit };

          if (productId) {
            endpoint = `ciProducts/${productId}/workflows`;
          }

          const data = await ascGet(endpoint, params, creds);

          return {
            success: true,
            data: {
              workflows: (data.data || []).map((w: any) => ({
                id: w.id,
                name: w.attributes?.name,
                description: w.attributes?.description,
                isEnabled: w.attributes?.isEnabled,
                isLockedForEditing: w.attributes?.isLockedForEditing,
                lastModifiedDate: w.attributes?.lastModifiedDate,
                branchStartCondition: w.attributes?.branchStartCondition,
                actions: w.attributes?.actions?.map((a: any) => ({
                  name: a.name,
                  actionType: a.actionType,
                  platform: a.platform,
                  scheme: a.scheme,
                })),
              })),
              count: (data.data || []).length,
            },
            executionTime: Date.now() - startTime,
          };
        }

        // START-BUILD — trigger a new build run
        case 'start-build': {
          if (!workflowId) {
            return { success: false, error: 'workflowId ist erforderlich fuer start-build', data: null, executionTime: Date.now() - startTime };
          }

          // First, find the git reference (source control branch)
          const refsData = await ascGet(
            `ciWorkflows/${workflowId}/repository`,
            {},
            creds,
          ).catch(() => null);

          const buildData = await ascPost('ciBuildRuns', {
            data: {
              type: 'ciBuildRuns',
              relationships: {
                workflow: {
                  data: { type: 'ciWorkflows', id: workflowId },
                },
              },
              attributes: {
                sourceBranchOrTag: {
                  kind: 'BRANCH',
                  name: gitReference,
                  isAllMatch: false,
                },
              },
            },
          }, creds);

          return {
            success: true,
            data: {
              buildRunId: buildData.data?.id,
              workflowId,
              gitReference,
              status: buildData.data?.attributes?.executionProgress || 'PENDING',
              startedDate: buildData.data?.attributes?.startedDate,
              message: `Build gestartet fuer Branch "${gitReference}"`,
            },
            executionTime: Date.now() - startTime,
          };
        }

        // LIST-BUILDS — list recent builds
        case 'list-builds': {
          let endpoint = 'ciBuildRuns';
          const params: Record<string, any> = { limit, sort: '-number' };

          if (workflowId) {
            endpoint = `ciWorkflows/${workflowId}/buildRuns`;
          }

          const data = await ascGet(endpoint, params, creds);

          return {
            success: true,
            data: {
              builds: (data.data || []).map((b: any) => ({
                id: b.id,
                number: b.attributes?.number,
                executionProgress: b.attributes?.executionProgress,
                completionStatus: b.attributes?.completionStatus,
                startedDate: b.attributes?.startedDate,
                finishedDate: b.attributes?.finishedDate,
                sourceCommit: b.attributes?.sourceCommit,
                isPullRequestBuild: b.attributes?.isPullRequestBuild,
              })),
              count: (data.data || []).length,
            },
            executionTime: Date.now() - startTime,
          };
        }

        // GET-BUILD — get details of a specific build
        case 'get-build': {
          if (!buildId) {
            return { success: false, error: 'buildId ist erforderlich', data: null, executionTime: Date.now() - startTime };
          }

          const data = await ascGet(`ciBuildRuns/${buildId}`, {
            include: 'builds,actions',
          }, creds);

          const build = data.data;

          return {
            success: true,
            data: {
              id: build?.id,
              number: build?.attributes?.number,
              executionProgress: build?.attributes?.executionProgress,
              completionStatus: build?.attributes?.completionStatus,
              startedDate: build?.attributes?.startedDate,
              finishedDate: build?.attributes?.finishedDate,
              sourceCommit: build?.attributes?.sourceCommit,
              destinationBranch: build?.attributes?.destinationBranch,
              actions: (data.included || [])
                .filter((i: any) => i.type === 'ciBuildActions')
                .map((a: any) => ({
                  id: a.id,
                  name: a.attributes?.name,
                  actionType: a.attributes?.actionType,
                  completionStatus: a.attributes?.completionStatus,
                  executionProgress: a.attributes?.executionProgress,
                  issueCounts: a.attributes?.issueCounts,
                })),
            },
            executionTime: Date.now() - startTime,
          };
        }

        // CANCEL-BUILD — cancel a running build
        case 'cancel-build': {
          if (!buildId) {
            return { success: false, error: 'buildId ist erforderlich', data: null, executionTime: Date.now() - startTime };
          }

          // Cancel by patching the build run
          // Note: ASC API uses DELETE for cancellation in some versions
          try {
            await ascDelete(`ciBuildRuns/${buildId}`, creds);
          } catch {
            // Alternative: try PATCH
            await ascPatch(`ciBuildRuns/${buildId}`, {
              data: {
                type: 'ciBuildRuns',
                id: buildId,
                attributes: { canceled: true },
              },
            }, creds);
          }

          return {
            success: true,
            data: {
              buildId,
              message: 'Build-Abbruch angefordert',
            },
            executionTime: Date.now() - startTime,
          };
        }

        // LIST-ARTIFACTS — list build artifacts
        case 'list-artifacts': {
          if (!buildId) {
            return { success: false, error: 'buildId ist erforderlich', data: null, executionTime: Date.now() - startTime };
          }

          // Get build actions first
          const actionsData = await ascGet(
            `ciBuildRuns/${buildId}/actions`,
            { limit: 20 },
            creds,
          );

          const allArtifacts: any[] = [];

          for (const action of actionsData.data || []) {
            const artifactsData = await ascGet(
              `ciBuildActions/${action.id}/artifacts`,
              { limit: 50 },
              creds,
            );

            for (const artifact of artifactsData.data || []) {
              allArtifacts.push({
                id: artifact.id,
                fileName: artifact.attributes?.fileName,
                fileSize: artifact.attributes?.fileSize,
                downloadUrl: artifact.attributes?.downloadUrl,
                actionName: action.attributes?.name,
              });
            }
          }

          return {
            success: true,
            data: {
              buildId,
              artifacts: allArtifacts,
              count: allArtifacts.length,
            },
            executionTime: Date.now() - startTime,
          };
        }

        // GET-LOGS — get build logs
        case 'get-logs': {
          if (!buildId) {
            return { success: false, error: 'buildId ist erforderlich', data: null, executionTime: Date.now() - startTime };
          }

          const actionsData = await ascGet(
            `ciBuildRuns/${buildId}/actions`,
            { limit: 20 },
            creds,
          );

          const logs: any[] = [];

          for (const action of actionsData.data || []) {
            // Get build action issues (errors, warnings)
            const issuesData = await ascGet(
              `ciBuildActions/${action.id}/issues`,
              { limit: 100 },
              creds,
            ).catch(() => ({ data: [] }));

            logs.push({
              actionId: action.id,
              actionName: action.attributes?.name,
              actionType: action.attributes?.actionType,
              completionStatus: action.attributes?.completionStatus,
              issueCounts: action.attributes?.issueCounts,
              issues: (issuesData.data || []).map((issue: any) => ({
                category: issue.attributes?.category,
                message: issue.attributes?.message,
                fileSource: issue.attributes?.fileSource,
              })),
            });
          }

          return {
            success: true,
            data: {
              buildId,
              actions: logs,
            },
            executionTime: Date.now() - startTime,
          };
        }

        default:
          return {
            success: false,
            error: `Unbekannte Aktion: ${action}`,
            data: null,
            executionTime: Date.now() - startTime,
          };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in manage-xcode-cloud:', error);
      return {
        success: false,
        error: `Fehler bei Xcode Cloud-Operation: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

export const xcodeCloudTools: ToolDefinition[] = [
  manageXcodeCloud,
];

export default xcodeCloudTools;
