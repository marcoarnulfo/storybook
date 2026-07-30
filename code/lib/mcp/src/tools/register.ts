/**
 * Registers the docs tools of a hosted Storybook from the shared core toolset.
 *
 * Everything an MCP client observes — the frozen tool names, the descriptions, the schemas and the
 * rendered text — comes from the toolset. This module contributes only what is specific to serving
 * a hosted Storybook: building the per-request access over the manifest provider, composing one
 * access per source, and the telemetry callbacks this package's embedders rely on.
 */

import type { McpServer } from 'tmcp';
import {
  createDocsToolset,
  createProviderDocsAccess,
  isDocsShowError,
  isDocsShowStoryError,
  MCP_TOOL_NAMES,
  MCP_TOOL_TITLES,
  resolveToolsetDescription,
  type DocsSource,
  type DocsToolset,
  type ToolsetCtx,
} from 'storybook/internal/toolsets-docs';

import type { StorybookContext } from '../types.ts';
import { errorToMCPContent } from '../utils/error-to-mcp-content.ts';

export const LIST_TOOL_NAME = MCP_TOOL_NAMES['docs.list'];
export const GET_TOOL_NAME = MCP_TOOL_NAMES['docs.show'];
export const GET_STORY_TOOL_NAME = MCP_TOOL_NAMES['docs.showStory'];

type Server = McpServer<any, StorybookContext>;
type ToolEnabled = Parameters<Server['tool']>[0]['enabled'];

const ctx: ToolsetCtx = {
  consumer: 'mcp',
  getService: () => {
    throw new Error('Open services are not available in a hosted Storybook.');
  },
};

/** True when this Storybook is serving a composition rather than itself alone. */
function getSources(context: StorybookContext | undefined): DocsSource[] | undefined {
  const sources = context?.sources;
  if (!sources?.some((source) => source.url)) {
    return undefined;
  }

  return sources.map((source) => ({
    source,
    access: createProviderDocsAccess({
      source,
      manifestProvider: context?.manifestProvider,
      getRequest: () => context?.request,
      resolveEntry: context?.resolveEntry,
    }),
  }));
}

/**
 * Builds the toolset for one request.
 *
 * The manifests, the provider and the composed sources all belong to the request being served, so
 * the toolset is assembled per call. It is a plain object of schemas and functions, which is why
 * that is cheap enough to do rather than threading request state through a shared instance.
 */
function toolsetFor(context: StorybookContext | undefined): DocsToolset {
  const sources = getSources(context);
  if (sources) {
    return createDocsToolset({ sources });
  }

  return createDocsToolset({
    docsAccess: createProviderDocsAccess({
      manifestProvider: context?.manifestProvider,
      getRequest: () => context?.request,
      resolveEntry: context?.resolveEntry,
    }),
  });
}

/**
 * Metadata is read from a toolset with no access behind it: names, titles, descriptions and schemas
 * are static, and only `multiSource` changes them.
 */
function metadataToolset(multiSource: boolean): DocsToolset {
  const unavailable = {
    list: async () => ({ componentManifest: { v: 1 as const, components: {} } }),
    resolve: async () => undefined,
  };
  return multiSource
    ? createDocsToolset({
        sources: [{ source: { id: 'local', title: 'Local' }, access: unavailable }],
      })
    : createDocsToolset({ docsAccess: unavailable });
}

function toolMetadata(method: 'docs.list' | 'docs.show' | 'docs.showStory', multiSource: boolean) {
  const [, methodName] = method.split('.') as [string, 'list' | 'show' | 'showStory'];
  const definition = metadataToolset(multiSource).methods[methodName];

  return {
    name: MCP_TOOL_NAMES[method],
    title: MCP_TOOL_TITLES[method],
    description: resolveToolsetDescription(definition.description, ctx),
    schema: definition.schema,
  };
}

export function getListAllDocumentationToolMetadata(options?: { multiSource?: boolean }) {
  return toolMetadata('docs.list', !!options?.multiSource);
}

export function getDocumentationToolMetadata(options?: { multiSource?: boolean }) {
  return toolMetadata('docs.show', !!options?.multiSource);
}

export function getStoryDocumentationToolMetadata(options?: { multiSource?: boolean }) {
  return toolMetadata('docs.showStory', !!options?.multiSource);
}

/**
 * Runs one method against the request's toolset and shapes it into an MCP result.
 *
 * A manifest that cannot be fetched or parsed is reported as tool output rather than thrown, so the
 * agent reads why instead of receiving a transport error. `data` is undefined in that case, which
 * is how the callers know to skip their telemetry hooks.
 */
async function call<TMethod extends 'list' | 'show' | 'showStory'>(
  server: Server,
  method: TMethod,
  input: unknown,
  isError?: (data: any) => boolean
) {
  const context = server.ctx.custom;

  try {
    const definition = toolsetFor(context).methods[method];
    const data = await (definition.handler as (i: unknown, c: ToolsetCtx) => Promise<unknown>)(
      input,
      ctx
    );
    const text = (definition.format as (d: unknown, c: ToolsetCtx) => string)(data, ctx);

    return {
      data,
      result: {
        content: [{ type: 'text' as const, text }],
        ...(isError?.(data) ? { isError: true as const } : {}),
      },
    };
  } catch (error) {
    return { data: undefined, result: errorToMCPContent(error) };
  }
}

export async function addListAllDocumentationTool(
  server: Server,
  enabled?: ToolEnabled,
  options?: { multiSource?: boolean }
) {
  server.tool(
    { ...getListAllDocumentationToolMetadata(options), enabled } as never,
    (async (input: unknown) => {
      const context = server.ctx.custom;
      const { data, result } = await call(server, 'list', input);

      // The embedder's telemetry hook predates the toolset and reports one source's manifests.
      const listing = data as { manifests?: any; sources?: any[] } | undefined;
      const manifests =
        listing?.manifests ?? listing?.sources?.find((entry) => entry.manifests)?.manifests;
      if (manifests) {
        await context?.onListAllDocumentation?.({
          context: context!,
          manifests,
          resultText: result.content[0].text,
          ...(listing?.sources ? { sources: listing.sources } : {}),
        });
      }

      return result;
    }) as never
  );
}

export async function addGetDocumentationTool(
  server: Server,
  enabled?: ToolEnabled,
  options?: { multiSource?: boolean }
) {
  server.tool(
    { ...getDocumentationToolMetadata(options), enabled } as never,
    (async (input: { id: string; storybookId?: string }) => {
      const context = server.ctx.custom;
      const { data, result } = await call(server, 'show', input, isDocsShowError);

      // Skipped when the manifest itself could not be read: that is a transport failure, not a
      // lookup with an outcome to report.
      if (data) {
        const { entry } = data as {
          entry?: { kind: string; component?: unknown; doc?: unknown };
        };
        const found = entry
          ? entry.kind === 'component'
            ? entry.component
            : entry.doc
          : undefined;

        await context?.onGetDocumentation?.(
          found
            ? {
                context: context!,
                input,
                foundDocumentation: found as never,
                resultText: result.content[0].text,
              }
            : { context: context!, input }
        );
      }

      return result;
    }) as never
  );
}

export async function addGetStoryDocumentationTool(
  server: Server,
  enabled?: ToolEnabled,
  options?: { multiSource?: boolean }
) {
  server.tool(
    { ...getStoryDocumentationToolMetadata(options), enabled } as never,
    (async (input: unknown) =>
      (await call(server, 'showStory', input, isDocsShowStoryError)).result) as never
  );
}
