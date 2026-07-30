import * as v from 'valibot';

import { defineToolset, type ToolsetCtx } from '../../toolset-definition.ts';
import { getRef } from '../../toolset-names.ts';
import type { DocsAccess, ResolvedDocsEntry } from './access.ts';
import {
  formatComponentManifest,
  formatDocsManifest,
  formatManifestsToLists,
  formatMultiSourceManifestsToLists,
  formatStoryDocumentation,
  MAX_STORIES_TO_SHOW,
} from './manifest-formatter/markdown.ts';
import type { AllManifests } from './manifest-formatter/manifest-types.ts';
import { listSources, resolveInSource, type DocsSource } from './multi-source.ts';
import type { SourceListing } from './sources.ts';

/**
 * Which Storybooks these tools serve — exactly one of the two.
 *
 * Modelled as an exclusive union so neither "no access at all" nor "both, one silently winning" can
 * be constructed: a composition takes a `storybookId` on every lookup and a single Storybook must
 * not ask for one, and that difference is decided here.
 */
export type CreateDocsToolsetOptions =
  | {
      /** Reads the one Storybook these tools serve. */
      docsAccess: DocsAccess;
      sources?: never;
    }
  | {
      /** The composed Storybooks these tools serve; ids are only unique within a source. */
      sources: DocsSource[];
      docsAccess?: never;
    };

export type DocsListOutput = {
  withStoryIds: boolean;
  /** Single-source listing. */
  manifests?: AllManifests;
  /** Per-source listings, in composition. */
  sources?: SourceListing[];
};

export type DocsShowOutput = {
  id: string;
  entry?: ResolvedDocsEntry;
  storybookId?: string;
  /** Set when the request named no source, or one that does not exist. */
  sourceError?: string;
};

export type DocsShowStoryOutput = {
  componentId: string;
  storyName: string;
  entry?: ResolvedDocsEntry;
  storybookId?: string;
  sourceError?: string;
};

/** Whether `docs.show` failed: an unusable source, or an id that resolved to nothing. */
export function isDocsShowError({ entry, sourceError }: DocsShowOutput): boolean {
  return sourceError !== undefined || entry === undefined;
}

/** Whether `docs.showStory` failed: an unusable source, a missing component, or a missing story. */
export function isDocsShowStoryError({
  entry,
  storyName,
  sourceError,
}: DocsShowStoryOutput): boolean {
  if (sourceError !== undefined || entry === undefined || entry.kind !== 'component') {
    return true;
  }
  return !entry.component.stories?.some((story) => story.name === storyName);
}

function describeList(ctx: ToolsetCtx): string {
  const ref = getRef(ctx);
  return `List all available UI components and documentation entries from the Storybook, returning the IDs the other documentation tools take as input. Call this first for any UI task — before writing a new component, check what the design system already provides and build on it instead of hand-rolling a duplicate; before answering any question about props, API, or usage, discover the relevant IDs here rather than reading component source. Then fetch the entries with ${ref('docs.show')}, referencing only IDs returned here — never guess IDs. When multiple Storybook sources are configured, entries from every source are included; scope follow-up calls to one source via their \`storybookId\` input. Pass \`withStoryIds: true\` when you need story IDs for other tools.`;
}

function describeShow(ctx: ToolsetCtx): string {
  return `Get documentation for a UI component or docs entry.

Returns the first ${MAX_STORIES_TO_SHOW} stories (including story IDs) with code snippets showing how props are used, plus TypeScript prop definitions. Call this before using a component to avoid hallucinating prop names, types, or valid combinations, and to answer any question about a component's props, API, or usage — reading or grepping the component source is not a substitute. Stories reveal real prop usage patterns, interactions, and edge cases that type definitions alone don't show. If the example stories don't show the prop you need, use the ${getRef(ctx)('docs.showStory')} tool to fetch the story documentation for the specific story variant you need.

Example: id="button" returns Primary, Secondary, Large stories with code like <Button variant="primary" size="large"> showing actual prop combinations.`;
}

/** Not-found message for an unknown component or docs id. */
function formatEntryNotFound(id: string, storybookId: string | undefined, ctx: ToolsetCtx): string {
  const suffix = storybookId ? ` in source "${storybookId}"` : '';
  return ctx.consumer === 'mcp'
    ? `Component or Docs Entry not found: "${id}"${suffix}. Use the ${getRef(ctx)('docs.list')} tool to see available components and documentation entries.`
    : `Component or Docs Entry not found: "${id}"${suffix}.`;
}

const storybookIdField = {
  storybookId: v.pipe(
    v.string(),
    v.description('The ID of the Storybook source to query (e.g., "local", "design-system")')
  ),
};

/**
 * Picks the access for a lookup, or explains which source the caller should have named.
 *
 * In a composition the id alone is ambiguous, so a missing or unknown `storybookId` is a result the
 * agent can act on — the available ids and where to find them — rather than a thrown error.
 */
function selectSource(
  sources: DocsSource[] | undefined,
  storybookId: string | undefined,
  ctx: ToolsetCtx
): { access?: DocsAccess; sourceError?: string } {
  if (!sources?.length) {
    return {};
  }

  const available = sources.map(({ source }) => source.id).join(', ');
  const listRef = `Use the ${getRef(ctx)('docs.list')} tool to see available sources.`;

  if (!storybookId) {
    return { sourceError: `storybookId is required. Available sources: ${available}. ${listRef}` };
  }

  const match = sources.find(({ source }) => source.id === storybookId);
  if (!match) {
    return {
      sourceError: `Storybook source not found: "${storybookId}". Available sources: ${available}. ${listRef}`,
    };
  }

  return { access: match.access };
}

/**
 * Creates the public docs API over an injected {@link DocsAccess}.
 *
 * The toolset never reads services or manifests itself, so the same definition serves the dev
 * server (open services or the built manifests), a hosted Storybook (manifest files over any
 * provider), and a composition of several of those.
 */
export function createDocsToolset(options: CreateDocsToolsetOptions) {
  const { docsAccess, sources } = options;
  const multiSource = !!sources?.length;

  // A composition needs the caller to say which Storybook they mean; a single one must not ask.
  const showSchema = multiSource
    ? v.object({
        id: v.pipe(v.string(), v.description('The component or docs entry ID (e.g., "button")')),
        ...storybookIdField,
      })
    : v.object({
        id: v.pipe(v.string(), v.description('The component or docs entry ID (e.g., "button")')),
      });

  const showStorySchema = multiSource
    ? v.object({ componentId: v.string(), storyName: v.string(), ...storybookIdField })
    : v.object({ componentId: v.string(), storyName: v.string() });

  /** The access for a lookup, plus the id it was scoped to. */
  const access = (storybookId: string | undefined, ctx: ToolsetCtx) =>
    multiSource ? selectSource(sources, storybookId, ctx) : { access: docsAccess };

  return defineToolset({
    id: 'docs',
    description: 'Storybook component and docs documentation.',
    methods: {
      list: {
        schema: v.object({
          withStoryIds: v.optional(
            v.pipe(
              v.boolean(),
              v.description(
                'When true, includes story sub-bullets under each component with story name and story ID. Use this to discover IDs for downstream story-focused workflows without filesystem lookup.'
              )
            ),
            false
          ),
        }),
        description: describeList,
        handler: async (input): Promise<DocsListOutput> => {
          const { withStoryIds } = input;
          if (multiSource) {
            return { withStoryIds, sources: await listSources(sources!, { withStoryIds }) };
          }
          return { withStoryIds, manifests: await docsAccess!.list({ withStoryIds }) };
        },
        format: ({ manifests, sources: listings, withStoryIds }: DocsListOutput) =>
          listings
            ? formatMultiSourceManifestsToLists(listings, { withStoryIds })
            : formatManifestsToLists(manifests!, { withStoryIds }),
      },
      show: {
        schema: showSchema,
        description: describeShow,
        handler: async (input, ctx): Promise<DocsShowOutput> => {
          const { id, storybookId } = input as { id: string; storybookId?: string };
          const selected = access(storybookId, ctx);
          if (selected.sourceError) {
            return { id, storybookId, sourceError: selected.sourceError };
          }

          return { id, storybookId, entry: await selected.access!.resolve(id) };
        },
        format: ({ id, entry, storybookId, sourceError }: DocsShowOutput, ctx) => {
          if (sourceError) {
            return sourceError;
          }
          if (!entry) {
            return formatEntryNotFound(id, storybookId, ctx);
          }
          return entry.kind === 'doc'
            ? formatDocsManifest(entry.doc)
            : formatComponentManifest(entry.component);
        },
      },
      showStory: {
        schema: showStorySchema,
        description:
          'Get detailed documentation for a specific story variant of a UI component. Use this when you need to see more usage examples of a component, via the stories written for it.',
        handler: async (input, ctx): Promise<DocsShowStoryOutput> => {
          const { componentId, storyName, storybookId } = input as {
            componentId: string;
            storyName: string;
            storybookId?: string;
          };
          const selected = access(storybookId, ctx);
          if (selected.sourceError) {
            return { componentId, storyName, storybookId, sourceError: selected.sourceError };
          }

          return {
            componentId,
            storyName,
            storybookId,
            entry: await selected.access!.resolve(componentId),
          };
        },
        format: ({ componentId, storyName, entry, sourceError }: DocsShowStoryOutput, ctx) => {
          if (sourceError) {
            return sourceError;
          }
          if (!entry || entry.kind !== 'component') {
            return ctx.consumer === 'mcp'
              ? `Component not found: "${componentId}". Use the ${getRef(ctx)('docs.list')} tool to see available components.`
              : `Component not found: "${componentId}".`;
          }

          const story = entry.component.stories?.find((candidate) => candidate.name === storyName);
          if (!story) {
            const availableStories = entry.component.stories?.map((s) => s.name).join(', ');
            return `Story "${storyName}" not found for component "${componentId}". Available stories: ${availableStories || 'none'}`;
          }

          return formatStoryDocumentation(entry.component, storyName);
        },
      },
    },
  });
}

export type DocsToolset = ReturnType<typeof createDocsToolset>;
