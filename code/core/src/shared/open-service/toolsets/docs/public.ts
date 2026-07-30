/**
 * Dependency-light entry for the docs toolset (`storybook/internal/toolsets-docs`).
 *
 * `@storybook/mcp` consumes the manifest formatter and toolset from here and bundles this entry
 * into its own dist (core is only a dev dependency there), so everything reachable from this file
 * must stay free of Node-only and server-only imports.
 */

export type { DocsAccess, ResolvedDocsEntry } from './access.ts';
export { createDocsToolset } from './definition.ts';
export type {
  CreateDocsToolsetOptions,
  DocsListOutput,
  DocsShowOutput,
  DocsShowStoryOutput,
  DocsToolset,
} from './definition.ts';
export {
  adaptCoreComponent,
  adaptCoreDoc,
  adaptCoreStories,
  type CoreDocgenComponent,
} from './manifest-formatter/adapt-core-manifest.ts';
export {
  extractDocsSummary,
  MAX_SUMMARY_LENGTH,
} from './manifest-formatter/extract-docs-summary.ts';
export type {
  AllManifests,
  ComponentManifest,
  ComponentManifestEntry,
  ComponentManifestMap,
  ComponentManifestV0,
  ComponentManifestV1,
  Doc,
  DocEntry,
  DocsManifestMap,
  DocV0,
  DocV1,
  ManifestError,
  Story,
  SubcomponentManifest,
} from './manifest-formatter/manifest-types.ts';
export {
  formatComponentManifest,
  formatDocsManifest,
  formatManifestsToLists,
  formatStoryDocumentation,
  MAX_STORIES_TO_SHOW,
} from './manifest-formatter/markdown.ts';
export {
  parseReactComponentMeta,
  parseReactDocgen,
  parseReactDocgenTypescript,
  type ParsedDocgen,
} from './manifest-formatter/parse-react-docgen.ts';
