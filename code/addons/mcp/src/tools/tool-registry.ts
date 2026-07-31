import type { McpServer } from 'tmcp';
import type { Options } from 'storybook/internal/types';
import { logger } from 'storybook/internal/node-logger';
import { OpenServiceMissingToolsetError } from 'storybook/internal/server-errors';
import {
  createCompositionDocsSources,
  createDocsToolset,
  isDocsShowError,
  isDocsShowStoryError,
  type DocsToolset,
} from 'storybook/internal/toolsets-docs';
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
import { GET_UI_BUILDING_INSTRUCTIONS_TOOL_NAME } from './tool-names.ts';
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
    // register later from their preset hooks. Each availability gate is written to match the
    // condition under which its toolset registers; if they still disagree, resolution fails loudly
    // (getToolset throws) and the registry drops that one row with an error log rather than taking
    // down the whole server (see resolveDefinitionOrDrop).
    name: MCP_TOOL_NAMES[options.method],
    available: (context) => available?.(context) ?? true,
    getMetadata: () => getToolsetToolMetadata(options),
    register: async (server, context, enabled) => {
      registerToolsetTool(server, options, wrapEnabled?.(server, context, enabled) ?? enabled);
    },
  };
}

/**
 * The docs rows carry no telemetry of their own: the events live on the toolset's methods, so the
 * CLI reports them too.
 */
const docsListOptions: ToolsetToolOptions = {
  method: 'docs.list',
  telemetryToolset: 'docs',
};

const docsShowOptions: ToolsetToolOptions = {
  method: 'docs.show',
  telemetryToolset: 'docs',
  resultIsError: (data) => isDocsShowError(data as never),
};

const docsShowStoryOptions: ToolsetToolOptions = {
  method: 'docs.showStory',
  telemetryToolset: 'docs',
  resultIsError: (data) => isDocsShowStoryError(data as never),
};

/**
 * Builds the docs toolset for a composition.
 *
 * The composed sources, their manifest provider and the local source's own access all arrive with
 * the request, so this cannot be the toolset registered once at boot. Called
 * without a server for metadata only, where the sources shape the schemas but nothing is fetched.
 */
function compositionDocsToolset(server?: McpServer<any, AddonContext>): DocsToolset {
  const custom = server?.ctx.custom;
  return createDocsToolset({
    sources: createCompositionDocsSources({
      sources: custom?.sources ?? [{ id: 'local', title: 'Local' }],
      manifestProvider: custom?.manifestProvider,
      getRequest: () => custom?.request,
      localAccess: custom?.localAccess,
    }),
  });
}

/** The docs rows, in the two shapes the registry needs: registered toolset, or per-request one. */
function docsRow(
  method: 'docs.list' | 'docs.show' | 'docs.showStory',
  options: ToolsetToolOptions
): AddonToolDefinition {
  const methodName = method.split('.')[1] as 'list' | 'show' | 'showStory';
  const forContext = (context: AddonToolRegistryContext): ToolsetToolOptions =>
    context.multiSource
      ? {
          ...options,
          resolveMethod: (server) => compositionDocsToolset(server).methods[methodName],
        }
      : options;

  return {
    name: MCP_TOOL_NAMES[method],
    toolset: 'docs',
    available: ({ availability }) => availability.docsEnabled,
    getMetadata: (context) => getToolsetToolMetadata(forContext(context)),
    register: async (server, context, enabled) => {
      registerToolsetTool(server, forContext(context), enabled);
    },
  };
}

const docsToolDefinitions: AddonToolDefinition[] = [
  docsRow('docs.list', docsListOptions),
  docsRow('docs.show', docsShowOptions),
  docsRow('docs.showStory', docsShowStoryOptions),
];

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
    name: GET_UI_BUILDING_INSTRUCTIONS_TOOL_NAME,
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
        addonVitestAvailable: availability.testSupported,
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
    options: {
      method: 'test.run',
      telemetryToolset: 'test',
      // Failed and cancelled runs report through data (the old tool threw); the flag must come
      // back or clients keying on `isError` count a crashed vitest run as a pass.
      resultIsError: (data) => {
        const status = (data as { status?: string }).status;
        return status === 'error' || status === 'cancelled';
      },
    },
  }),
  // Docs run on the core docs toolset in both modes. A composition builds its toolset per request,
  // because the sources it reads and the provider that fetches them belong to the request.
  ...docsToolDefinitions,
];

/**
 * Logs and drops one tool row when its availability gate said yes but the backing toolset never
 * registered.
 *
 * That mismatch is a wiring bug (each gate is written to match its toolset's registration
 * condition), but it must cost the user one tool, not the whole MCP server or the `storybook ai`
 * metadata build — the error log keeps it loud. Only this one error is contained: every other
 * failure rethrows, so a genuinely broken adapter still fails fast.
 */
// The name check backs up `instanceof`: the error can be constructed by a different copy of the
// class when the registry and this adapter resolve through different core entries (or src vs
// dist in tests). The expected identity — `StorybookError`'s stable code + name — is computed
// from the imported class, and matched exactly so a near-miss still fails fast.
const MISSING_TOOLSET_ERROR_NAME = new OpenServiceMissingToolsetError({ toolsetId: '' }).name;
const isMissingToolsetError = (error: unknown): boolean =>
  error instanceof OpenServiceMissingToolsetError ||
  (error instanceof Error && error.name === MISSING_TOOLSET_ERROR_NAME);

function dropRowIfToolsetMissing(name: string, error: unknown): undefined {
  if (!isMissingToolsetError(error)) {
    throw error;
  }
  logger.error(`Skipping MCP tool "${name}", its backing toolset is not registered: ${error}`);
  return undefined;
}

function resolveDefinitionOrDrop<T>(name: string, resolve: () => T): T | undefined {
  try {
    return resolve();
  } catch (error) {
    return dropRowIfToolsetMissing(name, error);
  }
}

export function getAddonToolMetadata(context: AddonToolRegistryContext): ToolMetadata[] {
  return addonToolDefinitions
    .filter((definition) => isMetadataToolEnabled(definition, context))
    .flatMap((definition) => {
      const metadata = resolveDefinitionOrDrop(definition.name, () =>
        definition.getMetadata(context)
      );
      return metadata ? [metadata] : [];
    });
}

export function getAddonLocalTools(
  context: AddonToolRegistryContext & { options: Options }
): Record<string, StorybookAiLocalTool> {
  return Object.fromEntries(
    addonToolDefinitions
      .filter((definition) => isMetadataToolEnabled(definition, context))
      .flatMap((definition) => {
        const localTool = resolveDefinitionOrDrop(definition.name, () =>
          definition.getLocalTool?.(context)
        );
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
      try {
        await definition.register(
          server,
          context,
          createToolsetEnabled(server, definition.toolset)
        );
      } catch (error) {
        dropRowIfToolsetMissing(definition.name, error);
      }
    }
  }
}
