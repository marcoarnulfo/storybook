/**
 * Environment-agnostic open-service API (`storybook/open-service`).
 *
 * Use this entrypoint for shared service definitions imported by manager, preview, and server.
 * Register in the manager with `storybook/manager-api` (hooks), in preview with `storybook/preview-api`,
 * or on the server via core-server experimental APIs.
 */
export { defineService } from './service-definition.ts';
export { seedQueryState } from './query-state.ts';

export { defineToolset, resolveToolsetDescription } from './toolset-definition.ts';
export type {
  AnyToolsetDefinition,
  ToolsetConsumer,
  ToolsetCtx,
  ToolsetDefinition,
  ToolsetGetService,
  ToolsetMethod,
  ToolsetMethodDescription,
  ToolsetTelemetry,
} from './toolset-definition.ts';
export { getRef, MCP_TOOL_NAMES } from './toolset-names.ts';
export type { ToolsetMethodRef } from './toolset-names.ts';
export {
  getRegisteredToolsets,
  getToolset,
  hasToolset,
  registerToolset,
} from './toolset-registry.ts';
export type { KnownToolsets } from './toolset-types.ts';

/** Exposed for addon-vitest, which owns the channel the test toolset runs on. */
export { createTestToolset } from './toolsets/test/definition.ts';
export type { CreateTestToolsetOptions, TestToolset } from './toolsets/test/definition.ts';

export type { DocgenService } from './services/docgen/definition.ts';
export type { DocgenPayload } from './services/docgen/types.ts';
export type { StoryDocsService } from './services/story-docs/definition.ts';
export {
  prependImportToSnippet,
  selectSnippetForStory,
  selectStoryDoc,
} from './services/story-docs/snippet.ts';

export type {
  AnyServiceDefinition,
  Command,
  CommandCtx,
  CommandDefinition,
  CommandSelf,
  LoadCtx,
  LoadSelf,
  LoadStatus,
  OperationDescriptor,
  Query,
  QueryCtx,
  QueryDefinition,
  QueryFunctions,
  QuerySelf,
  QueryState,
  QueryStatus,
  RuntimeService,
  SchemaDescriptor,
  ServerServiceRegistration,
  ServiceDefinition,
  ServiceDescriptor,
  ServiceId,
  ServiceInstance,
  ServiceInstanceOf,
  ServiceRegistrationOptions,
  ServiceRegistryApi,
  ServiceState,
  ServiceSummary,
  StaticStore,
} from './types.ts';
