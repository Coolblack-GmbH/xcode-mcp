import { ToolResult, ToolHandler } from '../types.js';
import { logger } from '../utils/logger.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * manage-storekit-config — Create, read, or edit StoreKit Configuration files
 */
const manageStorekitConfig: ToolDefinition = {
  name: 'manage-storekit-config',
  description: 'Create, read, or edit StoreKit Configuration files (.storekit) for in-app purchase testing. Manage products, subscriptions, and subscription groups.',
  inputSchema: {
    type: 'object',
    properties: {
      configPath: {
        type: 'string',
        description: 'Path to the .storekit configuration file',
      },
      action: {
        type: 'string',
        enum: ['create', 'read', 'add-product', 'add-subscription', 'remove-product'],
        description: 'Action to perform',
      },
      productId: {
        type: 'string',
        description: 'Product identifier (e.g. "com.app.premium")',
      },
      productName: {
        type: 'string',
        description: 'Display name of the product',
      },
      productType: {
        type: 'string',
        enum: ['consumable', 'non-consumable', 'auto-renewable', 'non-renewing'],
        description: 'Product type',
      },
      price: {
        type: 'string',
        description: 'Price in decimal format (e.g. "4.99")',
      },
      subscriptionGroup: {
        type: 'string',
        description: 'Subscription group name (for auto-renewable subscriptions)',
      },
      subscriptionPeriod: {
        type: 'string',
        enum: ['P1W', 'P1M', 'P3M', 'P6M', 'P1Y'],
        description: 'Subscription period in ISO 8601 duration (e.g. P1M = 1 month)',
      },
      introOffer: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['free-trial', 'pay-as-you-go', 'pay-up-front'] },
          period: { type: 'string' },
          price: { type: 'string' },
        },
        description: 'Introductory offer configuration',
      },
    },
    required: ['configPath', 'action'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const configPath = args.configPath as string;
      const action = args.action as string;
      const productId = args.productId as string | undefined;
      const productName = args.productName as string | undefined;
      const productType = args.productType as string | undefined;
      const price = args.price as string | undefined;
      const subscriptionGroup = args.subscriptionGroup as string | undefined;
      const subscriptionPeriod = args.subscriptionPeriod as string | undefined;
      const introOffer = args.introOffer as { type: string; period: string; price: string } | undefined;

      logger.info(`StoreKit config ${action} on ${configPath}`);

      // READ action
      if (action === 'read') {
        if (!existsSync(configPath)) {
          return {
            success: false,
            error: `StoreKit-Konfiguration nicht gefunden: ${configPath}`,
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        const content = JSON.parse(readFileSync(configPath, 'utf-8'));
        const products = content.products || [];
        const subscriptionGroups = content.subscriptionGroups || [];

        return {
          success: true,
          data: {
            configPath,
            productCount: products.length,
            products: products.map((p: any) => ({
              id: p.id || p.productID,
              name: p.displayName || p.referenceName,
              type: p.type,
              price: p.price,
            })),
            subscriptionGroups: subscriptionGroups.map((g: any) => ({
              name: g.name || g.localizations?.[0]?.displayName,
              subscriptions: (g.subscriptions || []).map((s: any) => ({
                id: s.id || s.productID,
                name: s.displayName || s.referenceName,
                period: s.subscriptionPeriod,
                price: s.price,
              })),
            })),
          },
          executionTime: Date.now() - startTime,
        };
      }

      // CREATE action — generate a new StoreKit configuration
      if (action === 'create') {
        const config = {
          identifier: generateUUID(),
          type: 'Configuration',
          version: 3,
          products: [],
          subscriptionGroups: [],
          settings: {
            _applicationInternalID: '',
            _developerTeamID: '',
            _failTransactionsEnabled: false,
            _locale: 'en_US',
            _storefront: 'USA',
            _storeKitErrors: [],
          },
        };

        writeFileSync(configPath, JSON.stringify(config, null, 2));

        return {
          success: true,
          data: {
            configPath,
            message: 'StoreKit-Konfiguration erfolgreich erstellt',
          },
          executionTime: Date.now() - startTime,
        };
      }

      // Remaining actions need an existing config
      if (!existsSync(configPath)) {
        return {
          success: false,
          error: `StoreKit-Konfiguration nicht gefunden: ${configPath}. Bitte zuerst mit action=create erstellen.`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));

      // ADD-PRODUCT action
      if (action === 'add-product') {
        if (!productId || !productName || !productType) {
          return {
            success: false,
            error: 'productId, productName und productType sind erforderlich',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        const typeMap: Record<string, string> = {
          'consumable': 'Consumable',
          'non-consumable': 'NonConsumable',
          'non-renewing': 'NonRenewingSubscription',
        };

        const newProduct = {
          displayName: productName,
          familyShareable: false,
          id: generateUUID(),
          internalID: generateUUID(),
          localizations: [
            {
              description: productName,
              displayName: productName,
              locale: 'en_US',
            },
          ],
          productID: productId,
          referenceName: productName,
          type: typeMap[productType] || 'NonConsumable',
          ...(price ? { price: parseFloat(price) } : {}),
        };

        if (!config.products) config.products = [];
        config.products.push(newProduct);
        writeFileSync(configPath, JSON.stringify(config, null, 2));

        return {
          success: true,
          data: {
            configPath,
            product: { id: productId, name: productName, type: productType, price },
            message: `Produkt "${productName}" (${productId}) hinzugefuegt`,
          },
          executionTime: Date.now() - startTime,
        };
      }

      // ADD-SUBSCRIPTION action
      if (action === 'add-subscription') {
        if (!productId || !productName || !subscriptionGroup) {
          return {
            success: false,
            error: 'productId, productName und subscriptionGroup sind erforderlich',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        if (!config.subscriptionGroups) config.subscriptionGroups = [];

        // Find or create subscription group
        let group = config.subscriptionGroups.find(
          (g: any) => g.name === subscriptionGroup || g.localizations?.[0]?.displayName === subscriptionGroup,
        );

        if (!group) {
          group = {
            id: generateUUID(),
            localizations: [
              { description: subscriptionGroup, displayName: subscriptionGroup, locale: 'en_US' },
            ],
            name: subscriptionGroup,
            subscriptions: [],
          };
          config.subscriptionGroups.push(group);
        }

        const subscription: any = {
          adHocOffers: [],
          codeOffers: [],
          displayName: productName,
          familyShareable: false,
          groupNumber: group.subscriptions.length + 1,
          id: generateUUID(),
          internalID: generateUUID(),
          localizations: [
            { description: productName, displayName: productName, locale: 'en_US' },
          ],
          productID: productId,
          recurringSubscriptionPeriod: subscriptionPeriod || 'P1M',
          referenceName: productName,
          type: 'RecurringSubscription',
          ...(price ? { price: parseFloat(price) } : {}),
        };

        // Add intro offer if specified
        if (introOffer) {
          subscription.introductoryOffer = {
            internalID: generateUUID(),
            paymentMode: introOffer.type === 'free-trial' ? 'free'
              : introOffer.type === 'pay-as-you-go' ? 'payAsYouGo' : 'payUpFront',
            subscriptionPeriod: introOffer.period || subscriptionPeriod || 'P1W',
            ...(introOffer.price ? { price: parseFloat(introOffer.price) } : {}),
          };
        }

        group.subscriptions.push(subscription);
        writeFileSync(configPath, JSON.stringify(config, null, 2));

        return {
          success: true,
          data: {
            configPath,
            subscription: { id: productId, name: productName, group: subscriptionGroup, period: subscriptionPeriod },
            message: `Abo "${productName}" in Gruppe "${subscriptionGroup}" hinzugefuegt`,
          },
          executionTime: Date.now() - startTime,
        };
      }

      // REMOVE-PRODUCT action
      if (action === 'remove-product') {
        if (!productId) {
          return {
            success: false,
            error: 'productId ist erforderlich',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }

        let removed = false;

        // Remove from products
        if (config.products) {
          const before = config.products.length;
          config.products = config.products.filter((p: any) => p.productID !== productId);
          if (config.products.length < before) removed = true;
        }

        // Remove from subscription groups
        if (config.subscriptionGroups) {
          for (const group of config.subscriptionGroups) {
            if (group.subscriptions) {
              const before = group.subscriptions.length;
              group.subscriptions = group.subscriptions.filter((s: any) => s.productID !== productId);
              if (group.subscriptions.length < before) removed = true;
            }
          }
        }

        if (removed) {
          writeFileSync(configPath, JSON.stringify(config, null, 2));
        }

        return {
          success: true,
          data: {
            configPath,
            productId,
            removed,
            message: removed
              ? `Produkt "${productId}" erfolgreich entfernt`
              : `Produkt "${productId}" nicht gefunden`,
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
      logger.error('Error in manage-storekit-config:', error);
      return {
        success: false,
        error: `Fehler bei StoreKit-Operation: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Generate a pseudo-UUID for StoreKit config entries
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16).toUpperCase();
  });
}

export const storekitTools: ToolDefinition[] = [
  manageStorekitConfig,
];

export default storekitTools;
