import type { McpServer } from 'tmcp';
import type { Options } from 'storybook/internal/types';
import { logger } from 'storybook/internal/node-logger';
import {
  addGetDocumentationTool,
  addGetStoryDocumentationTool,
  addListAllDocumentationTool,
  GET_STORY_TOOL_NAME,
  GET_TOOL_NAME,
  getDocumentationToolMetadata,
  getListAllDocumentationToolMetadata,
  getStoryDocumentationToolMetadata,
  LIST_TOOL_NAME,
} from '@storybook/mcp';
import type { AddonContext } from '../types.ts';
import type { ToolAvailability } from '../utils/get-tool-availability.ts';
import { withFriendlyErrors } from '../utils/format-validation-issues.ts';
import { PREVIEW_STORIES_RESOURCE_URI, addPreviewStoriesResource } from './preview-stories.ts';
import {
  buildStorybookStoryInstructions,
  getStorybookStoryInstructionsToolMetadata,
  addGetUIBuildingInstructionsTool,
} from './get-storybook-story-instructions.ts';
import { MCP_TOOL_NAMES } from 'storybook/open-service';
import { resolveReviewOrigin } from './review-origin.ts';
import {
  getToolsetToolMetadata,
  registerToolsetTool,
  type ToolsetToolOptions,
} from './toolset-tools.ts';

export type ToolMetadata = {
  name: string;
  title?: string;
  description?: string;
  schema?: unknown;
  outputSchema?: unknown;
  _meta?: Record<string, unknown>;
};

export type StorybookAiToolCallResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type StorybookAiLocalTool = {
  call: (input?: Record<string, unknown>) => Promise<StorybookAiToolCallResult>;
};

export type AddonToolRegistryContext = {
  availability: ToolAvailability;
  multiSource?: boolean;
  toolsets?: AddonContext['toolsets'];
  options?: Options;
};

type AddonToolset = keyof NonNullable<AddonContext['toolsets']>;
type ToolEnabled = Parameters<McpServer<any, AddonContext>['tool']>[0]['enabled'];

type AddonToolDefinition = {
  name: string;
  toolset: AddonToolset;
  available?: (context: AddonToolRegistryContext) => boolean;
  getMetadata: (context: AddonToolRegistryContext) => ToolMetadata;
  register: (
    server: McpServer<any, AddonContext>,
    context: AddonToolRegistryContext,
    enabled: ToolEnabled
  ) => Promise<void>;
  getLocalTool?: (context: AddonToolRegistryContext & { options: Options }) => StorybookAiLocalTool;
};

const isToolsetEnabled = (toolset: AddonToolset, toolsets: AddonContext['toolsets'] | undefined) =>
  toolsets?.[toolset] ?? true;

const isToolAvailable = (definition: AddonToolDefinition, context: AddonToolRegistryContext) =>
  definition.available?.(context) ?? true;

const isMetadataToolEnabled = (
  definition: AddonToolDefinition,
  context: AddonToolRegistryContext
) => isToolsetEnabled(definition.toolset, context.toolsets) && isToolAvailable(definition, context);

const createToolsetEnabled =
  (server: McpServer<any, AddonContext>, toolset: AddonToolset): ToolEnabled =>
  () =>
    server.ctx.custom?.toolsets?.[toolset] ?? true;

/**
 * Declares an MCP tool that is backed by a core toolset method.
 *
 * The addon contributes only what is specific to this surface: the MCP toolset grouping, the
 * availability gate, and any MCP-only metadata. Name, title, description, schemas, behaviour and
 * telemetry all come from the method.
 */
function fromToolset(
  definition: Omit<AddonToolDefinition, 'name' | 'getMetadata' | 'register'> & {
    options: ToolsetToolOptions;
    available?: (context: AddonToolRegistryContext) => boolean;
    /** Narrows the tool further per request, on top of the toolset gate. */
    wrapEnabled?: (
      server: McpServer<any, AddonContext>,
      context: AddonToolRegistryContext,
      enabled: ToolEnabled
    ) => ToolEnabled;
  }
): AddonToolDefinition {
  const { options, available, wrapEnabled, ...rest } = definition;
  return {
    ...rest,
    // Read from the constant, not the registry: this array is built at import time, while toolsets
    // register later from their preset hooks. Availability deliberately does NOT consult the
    // registry — a missing toolset must fail loudly at resolution (getToolset throws), not silently
    // drop a tool from the list.
    name: MCP_TOOL_NAMES[options.method],
    available: (context) => available?.(context) ?? true,
    getMetadata: () => getToolsetToolMetadata(options),
    register: async (server, context, enabled) => {
      registerToolsetTool(server, options, wrapEnabled?.(server, context, enabled) ?? enabled);
    },
  };
}

const addonToolDefinitions: AddonToolDefinition[] = [
  fromToolset({
    toolset: 'dev',
    options: {
      method: 'stories.preview',
      telemetryToolset: 'dev',
      extras: { _meta: { ui: { resourceUri: PREVIEW_STORIES_RESOURCE_URI } } },
    },
  }),
  {
    name: 'get-storybook-story-instructions',
    toolset: 'dev',
    getMetadata: ({ availability, toolsets }) => {
      const testToolsetAvailable = isToolsetEnabled('test', toolsets) && availability.testSupported;
      return getStorybookStoryInstructionsToolMetadata({
        testToolsetAvailable,
        a11yAvailable: testToolsetAvailable && availability.a11yEnabled,
      });
    },
    register: (server, { availability, toolsets }, enabled) =>
      addGetUIBuildingInstructionsTool(server, enabled, {
        docsAvailable: isToolsetEnabled('docs', toolsets) && availability.docsEnabled,
      }),
    getLocalTool: ({ availability, toolsets, options }) => ({
      call: async () => {
        const text = await buildStorybookStoryInstructions(options, {
          toolsets,
          a11yEnabled: availability.a11yEnabled,
          addonVitestAvailable: availability.testSupported,
          docsAvailable: isToolsetEnabled('docs', toolsets) && availability.docsEnabled,
          reviewEnabled: availability.reviewEnabled,
        });
        return { content: [{ type: 'text', text }] };
      },
    }),
  },
  fromToolset({
    toolset: 'dev',
    available: ({ availability }) => availability.changeDetectionEnabled,
    options: { method: 'stories.changed', telemetryToolset: 'dev' },
  }),
  fromToolset({
    toolset: 'dev',
    available: ({ availability }) => availability.moduleGraphSupported,
    options: { method: 'stories.findByComponent', telemetryToolset: 'dev' },
  }),
  fromToolset({
    toolset: 'dev',
    // Registered whenever the CLI default could turn review on; the per-request `reviewEnabled`
    // context (explicit flag, or the trusted local-client header) decides whether a given MCP
    // client actually sees the tool.
    available: ({ availability }) => availability.reviewEnabledForCli,
    wrapEnabled:
      (server, { availability }, enabled) =>
      async () =>
        ((await enabled?.()) ?? true) &&
        (server.ctx.custom?.reviewEnabled ?? availability.reviewEnabled),
    options: {
      method: 'review.create',
      telemetryToolset: 'dev',
      wrapSchema: withFriendlyErrors,
      resolveOrigin: (server) => resolveReviewOrigin(server.ctx.custom ?? {}),
    },
  }),
  fromToolset({
    toolset: 'test',
    available: ({ availability }) => availability.testSupported,
    options: { method: 'test.run', telemetryToolset: 'test' },
  }),
  {
    name: LIST_TOOL_NAME,
    toolset: 'docs',
    available: ({ availability }) => availability.docsEnabled,
    getMetadata: () => getListAllDocumentationToolMetadata(),
    register: async (server, _context, enabled) => {
      logger.info(
        'Experimental components manifest feature detected - registering component tools'
      );
      await addListAllDocumentationTool(server, enabled);
    },
  },
  {
    name: GET_TOOL_NAME,
    toolset: 'docs',
    available: ({ availability }) => availability.docsEnabled,
    getMetadata: ({ multiSource }) => getDocumentationToolMetadata({ multiSource }),
    register: (server, { multiSource }, enabled) =>
      addGetDocumentationTool(server, enabled, {
        multiSource,
      }),
  },
  {
    name: GET_STORY_TOOL_NAME,
    toolset: 'docs',
    available: ({ availability }) => availability.docsEnabled,
    getMetadata: ({ multiSource }) => getStoryDocumentationToolMetadata({ multiSource }),
    register: (server, { multiSource }, enabled) =>
      addGetStoryDocumentationTool(server, enabled, {
        multiSource,
      }),
  },
];

export function getAddonToolMetadata(context: AddonToolRegistryContext): ToolMetadata[] {
  return addonToolDefinitions
    .filter((definition) => isMetadataToolEnabled(definition, context))
    .map((definition) => definition.getMetadata(context));
}

export function getAddonLocalTools(
  context: AddonToolRegistryContext & { options: Options }
): Record<string, StorybookAiLocalTool> {
  return Object.fromEntries(
    addonToolDefinitions
      .filter((definition) => isMetadataToolEnabled(definition, context))
      .flatMap((definition) => {
        const localTool = definition.getLocalTool?.(context);
        return localTool ? [[definition.name, localTool]] : [];
      })
  );
}

export async function registerAddonMcpTools(
  server: McpServer<any, AddonContext>,
  context: AddonToolRegistryContext
) {
  // The preview app resource is transport-level: it is served to the client independently of the
  // tool call that references it.
  await addPreviewStoriesResource(server);

  for (const definition of addonToolDefinitions) {
    if (
      isToolsetEnabled(definition.toolset, context.toolsets) &&
      isToolAvailable(definition, context)
    ) {
      await definition.register(server, context, createToolsetEnabled(server, definition.toolset));
    }
  }
}
