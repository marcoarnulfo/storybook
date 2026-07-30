import * as v from 'valibot';

import { defineToolset, type ToolsetCtx } from '../../toolset-definition.ts';
import { getRef } from '../../toolset-names.ts';
import type { DocsAccess, ResolvedDocsEntry } from './access.ts';
import {
  formatComponentManifest,
  formatDocsManifest,
  formatManifestsToLists,
  formatStoryDocumentation,
  MAX_STORIES_TO_SHOW,
} from './manifest-formatter/markdown.ts';
import type { AllManifests } from './manifest-formatter/manifest-types.ts';

export type CreateDocsToolsetOptions = {
  docsAccess: DocsAccess;
};

export type DocsListOutput = {
  manifests: AllManifests;
  withStoryIds: boolean;
};

export type DocsShowOutput = {
  id: string;
  entry: ResolvedDocsEntry | undefined;
};

export type DocsShowStoryOutput = {
  componentId: string;
  storyName: string;
  entry: ResolvedDocsEntry | undefined;
};

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
function formatEntryNotFound(id: string, ctx: ToolsetCtx): string {
  return ctx.consumer === 'mcp'
    ? `Component or Docs Entry not found: "${id}". Use the ${getRef(ctx)('docs.list')} tool to see available components and documentation entries.`
    : `Component or Docs Entry not found: "${id}".`;
}

/**
 * Creates the public docs API over an injected {@link DocsAccess}.
 *
 * The toolset never reads services or manifests itself, so the same definition serves the dev
 * server (open services or the built manifests) and a hosted Storybook (remote manifest files).
 */
export function createDocsToolset({ docsAccess }: CreateDocsToolsetOptions) {
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
        handler: async (input): Promise<DocsListOutput> => ({
          manifests: await docsAccess.list({ withStoryIds: input.withStoryIds }),
          withStoryIds: input.withStoryIds,
        }),
        format: ({ manifests, withStoryIds }: DocsListOutput) =>
          formatManifestsToLists(manifests, { withStoryIds }),
      },
      show: {
        schema: v.object({
          id: v.pipe(v.string(), v.description('The component or docs entry ID (e.g., "button")')),
        }),
        description: describeShow,
        handler: async (input): Promise<DocsShowOutput> => ({
          id: input.id,
          entry: await docsAccess.resolve(input.id),
        }),
        format: ({ id, entry }: DocsShowOutput, ctx) => {
          if (!entry) {
            return formatEntryNotFound(id, ctx);
          }
          return entry.kind === 'doc'
            ? formatDocsManifest(entry.doc)
            : formatComponentManifest(entry.component);
        },
      },
      showStory: {
        schema: v.object({
          componentId: v.pipe(v.string(), v.description('Component id.')),
          storyName: v.pipe(v.string(), v.description('Story display name (not story id).')),
        }),
        description: 'Returns documentation for one story of a component.',
        handler: async (input): Promise<DocsShowStoryOutput> => ({
          componentId: input.componentId,
          storyName: input.storyName,
          entry: await docsAccess.resolve(input.componentId),
        }),
        format: ({ componentId, storyName, entry }: DocsShowStoryOutput, ctx) => {
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
