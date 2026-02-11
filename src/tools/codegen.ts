import { ToolResult, ToolHandler } from '../types.js';
import { logger } from '../utils/logger.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * generate-code-snippet — Generate Swift boilerplate code from templates
 */
const generateCodeSnippet: ToolDefinition = {
  name: 'generate-code-snippet',
  description: 'Generate Swift boilerplate code snippets: MVVM ViewModel, Codable model, Protocol with default implementation, SwiftUI View, Network Service, Core Data entity, UserDefaults wrapper, or custom Combine publisher.',
  inputSchema: {
    type: 'object',
    properties: {
      template: {
        type: 'string',
        enum: [
          'mvvm-viewmodel',
          'codable-model',
          'protocol-with-default',
          'swiftui-view',
          'network-service',
          'coredata-entity',
          'userdefaults-wrapper',
          'combine-publisher',
        ],
        description: 'Template to generate',
      },
      name: {
        type: 'string',
        description: 'Name for the generated type (e.g. "User", "LoginViewModel")',
      },
      outputPath: {
        type: 'string',
        description: 'File path to write the generated code to (optional — if not set, returns code as output)',
      },
      properties: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Property name' },
            type: { type: 'string', description: 'Swift type (e.g. "String", "Int", "[Item]")' },
            optional: { type: 'boolean', description: 'Whether the property is optional' },
            defaultValue: { type: 'string', description: 'Default value (optional)' },
          },
        },
        description: 'Properties/fields for the generated type',
      },
      protocols: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional protocols to conform to (for codable-model, etc.)',
      },
      methods: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Method name' },
            params: { type: 'string', description: 'Parameter list (e.g. "id: Int, name: String")' },
            returnType: { type: 'string', description: 'Return type' },
            isAsync: { type: 'boolean', description: 'Whether the method is async' },
            throws: { type: 'boolean', description: 'Whether the method throws' },
          },
        },
        description: 'Methods to include (for protocol, service templates)',
      },
    },
    required: ['template', 'name'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const template = args.template as string;
      const name = args.name as string;
      const outputPath = args.outputPath as string | undefined;
      const properties = args.properties as Array<{ name: string; type: string; optional?: boolean; defaultValue?: string }> | undefined;
      const protocols = args.protocols as string[] | undefined;
      const methods = args.methods as Array<{ name: string; params?: string; returnType?: string; isAsync?: boolean; throws?: boolean }> | undefined;

      logger.info(`Generating ${template} snippet: ${name}`);

      let code: string;

      switch (template) {
        case 'mvvm-viewmodel':
          code = generateMVVM(name, properties, methods);
          break;
        case 'codable-model':
          code = generateCodable(name, properties, protocols);
          break;
        case 'protocol-with-default':
          code = generateProtocol(name, methods);
          break;
        case 'swiftui-view':
          code = generateSwiftUIView(name, properties);
          break;
        case 'network-service':
          code = generateNetworkService(name, methods);
          break;
        case 'coredata-entity':
          code = generateCoreDataEntity(name, properties);
          break;
        case 'userdefaults-wrapper':
          code = generateUserDefaultsWrapper(name, properties);
          break;
        case 'combine-publisher':
          code = generateCombinePublisher(name, properties, methods);
          break;
        default:
          return {
            success: false,
            error: `Unbekanntes Template: ${template}`,
            data: null,
            executionTime: Date.now() - startTime,
          };
      }

      // Write to file if outputPath specified
      if (outputPath) {
        const dir = dirname(outputPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(outputPath, code);
      }

      return {
        success: true,
        data: {
          template,
          name,
          outputPath: outputPath || null,
          code,
          lineCount: code.split('\n').length,
          message: outputPath
            ? `${template} fuer "${name}" nach ${outputPath} geschrieben`
            : `${template} fuer "${name}" generiert`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in generate-code-snippet:', error);
      return {
        success: false,
        error: `Fehler bei Code-Generierung: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

// ─── Template generators ────────────────────────────────────────────────────

function generateMVVM(
  name: string,
  properties?: Array<{ name: string; type: string; optional?: boolean; defaultValue?: string }>,
  methods?: Array<{ name: string; params?: string; returnType?: string; isAsync?: boolean; throws?: boolean }>,
): string {
  const props = properties || [];
  const publishedProps = props.map((p) => {
    const optMark = p.optional ? '?' : '';
    const defaultVal = p.defaultValue ? ` = ${p.defaultValue}` : (p.optional ? ' = nil' : '');
    return `    @Published var ${p.name}: ${p.type}${optMark}${defaultVal}`;
  }).join('\n');

  const methodStubs = (methods || []).map((m) => {
    const asyncKw = m.isAsync ? 'async ' : '';
    const throwsKw = m.throws ? 'throws ' : '';
    const ret = m.returnType ? ` -> ${m.returnType}` : '';
    const params = m.params || '';
    return `
    func ${m.name}(${params}) ${asyncKw}${throwsKw}${ret}{
        // TODO: Implementierung
    }`;
  }).join('\n');

  return `import Foundation
import Combine

@MainActor
final class ${name}: ObservableObject {
    // MARK: - Published Properties
${publishedProps || '    // Keine Properties definiert'}

    // MARK: - Private
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Init
    init() {
        // Setup bindings
    }

    // MARK: - Methods
${methodStubs || '    // Keine Methoden definiert'}
}
`;
}

function generateCodable(
  name: string,
  properties?: Array<{ name: string; type: string; optional?: boolean; defaultValue?: string }>,
  extraProtocols?: string[],
): string {
  const props = properties || [];
  const protoList = ['Codable', 'Hashable', 'Sendable', ...(extraProtocols || [])].join(', ');

  const propLines = props.map((p) => {
    const optMark = p.optional ? '?' : '';
    return `    let ${p.name}: ${p.type}${optMark}`;
  }).join('\n');

  // Generate CodingKeys if any property name contains underscore (snake_case mapping)
  const needsCodingKeys = props.some((p) => p.name.includes('_') || /[A-Z]/.test(p.name.charAt(0)));

  let codingKeys = '';
  if (needsCodingKeys && props.length > 0) {
    const keys = props.map((p) => {
      const snakeCase = p.name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      if (snakeCase !== p.name) {
        return `        case ${p.name} = "${snakeCase}"`;
      }
      return `        case ${p.name}`;
    }).join('\n');

    codingKeys = `

    enum CodingKeys: String, CodingKey {
${keys}
    }`;
  }

  return `import Foundation

struct ${name}: ${protoList} {
${propLines || '    // Keine Properties definiert'}${codingKeys}
}
`;
}

function generateProtocol(
  name: string,
  methods?: Array<{ name: string; params?: string; returnType?: string; isAsync?: boolean; throws?: boolean }>,
): string {
  const methodDefs = (methods || []).map((m) => {
    const asyncKw = m.isAsync ? 'async ' : '';
    const throwsKw = m.throws ? 'throws ' : '';
    const ret = m.returnType ? ` -> ${m.returnType}` : '';
    return `    func ${m.name}(${m.params || ''}) ${asyncKw}${throwsKw}${ret}`;
  }).join('\n');

  const defaultImpls = (methods || []).map((m) => {
    const asyncKw = m.isAsync ? 'async ' : '';
    const throwsKw = m.throws ? 'throws ' : '';
    const ret = m.returnType ? ` -> ${m.returnType}` : '';
    const defaultReturn = m.returnType
      ? `\n        fatalError("\\(#function) nicht implementiert")`
      : '';
    return `    func ${m.name}(${m.params || ''}) ${asyncKw}${throwsKw}${ret}{${defaultReturn}
    }`;
  }).join('\n\n');

  return `import Foundation

protocol ${name} {
${methodDefs || '    // Keine Methoden definiert'}
}

// MARK: - Default Implementation
extension ${name} {
${defaultImpls || '    // Keine Default-Implementierungen'}
}
`;
}

function generateSwiftUIView(
  name: string,
  properties?: Array<{ name: string; type: string; optional?: boolean; defaultValue?: string }>,
): string {
  const props = properties || [];
  const stateProps = props.map((p) => {
    const defaultVal = p.defaultValue || (p.type === 'String' ? '""' : p.type === 'Bool' ? 'false' : p.type === 'Int' ? '0' : '""');
    return `    @State private var ${p.name}: ${p.type} = ${defaultVal}`;
  }).join('\n');

  return `import SwiftUI

struct ${name}: View {
${stateProps || '    // Properties hier einfuegen'}

    var body: some View {
        VStack(spacing: 16) {
            Text("${name}")
                .font(.title)
        }
        .padding()
    }
}

#Preview {
    ${name}()
}
`;
}

function generateNetworkService(
  name: string,
  methods?: Array<{ name: string; params?: string; returnType?: string; isAsync?: boolean; throws?: boolean }>,
): string {
  const endpoints = (methods || [{ name: 'fetchData', returnType: 'Data', isAsync: true, throws: true }]).map((m) => {
    const ret = m.returnType || 'Data';
    return `
    func ${m.name}(${m.params || ''}) async throws -> ${ret} {
        let url = baseURL.appendingPathComponent("/${m.name.toLowerCase()}")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }

        return try decoder.decode(${ret}.self, from: data)
    }`;
  }).join('\n');

  return `import Foundation

final class ${name}: Sendable {
    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder

    init(
        baseURL: URL,
        session: URLSession = .shared,
        decoder: JSONDecoder = JSONDecoder()
    ) {
        self.baseURL = baseURL
        self.session = session
        self.decoder = decoder
    }
${endpoints}
}
`;
}

function generateCoreDataEntity(
  name: string,
  properties?: Array<{ name: string; type: string; optional?: boolean }>,
): string {
  const props = properties || [];
  const nsManaged = props.map((p) => {
    const optMark = p.optional ? '?' : '';
    return `    @NSManaged public var ${p.name}: ${p.type}${optMark}`;
  }).join('\n');

  return `import Foundation
import CoreData

@objc(${name})
public class ${name}: NSManagedObject {
${nsManaged || '    // Properties hier einfuegen'}
}

extension ${name}: Identifiable {
    @nonobjc public class func fetchRequest() -> NSFetchRequest<${name}> {
        return NSFetchRequest<${name}>(entityName: "${name}")
    }
}
`;
}

function generateUserDefaultsWrapper(
  name: string,
  properties?: Array<{ name: string; type: string; defaultValue?: string }>,
): string {
  const props = properties || [];
  const wrappedProps = props.map((p) => {
    const defaultVal = p.defaultValue || (p.type === 'String' ? '""' : p.type === 'Bool' ? 'false' : p.type === 'Int' ? '0' : 'nil');
    return `    @UserDefault(key: "${name}.${p.name}", defaultValue: ${defaultVal})
    var ${p.name}: ${p.type}`;
  }).join('\n\n');

  return `import Foundation

@propertyWrapper
struct UserDefault<T> {
    let key: String
    let defaultValue: T
    var container: UserDefaults = .standard

    var wrappedValue: T {
        get { container.object(forKey: key) as? T ?? defaultValue }
        set { container.set(newValue, forKey: key) }
    }
}

final class ${name} {
    static let shared = ${name}()
    private init() {}

${wrappedProps || '    // Properties hier einfuegen'}
}
`;
}

function generateCombinePublisher(
  name: string,
  properties?: Array<{ name: string; type: string }>,
  methods?: Array<{ name: string; returnType?: string }>,
): string {
  const outputType = properties?.[0]?.type || 'String';

  return `import Foundation
import Combine

struct ${name}: Publisher {
    typealias Output = ${outputType}
    typealias Failure = Error

    func receive<S: Subscriber>(subscriber: S) where S.Input == Output, S.Failure == Failure {
        let subscription = ${name}Subscription(subscriber: subscriber)
        subscriber.receive(subscription: subscription)
    }
}

private final class ${name}Subscription<S: Subscriber>: Subscription where S.Input == ${outputType}, S.Failure == Error {
    private var subscriber: S?

    init(subscriber: S) {
        self.subscriber = subscriber
    }

    func request(_ demand: Subscribers.Demand) {
        // TODO: Werte an Subscriber senden
        // _ = subscriber?.receive(value)
        // subscriber?.receive(completion: .finished)
    }

    func cancel() {
        subscriber = nil
    }
}
`;
}

export const codegenTools: ToolDefinition[] = [
  generateCodeSnippet,
];

export default codegenTools;
