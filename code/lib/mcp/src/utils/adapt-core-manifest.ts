import {
  adaptCoreComponent as sharedAdaptCoreComponent,
  adaptCoreDoc as sharedAdaptCoreDoc,
  adaptCoreStories as sharedAdaptCoreStories,
  type CoreDocgenComponent as SharedCoreDocgenComponent,
} from 'storybook/internal/toolsets-docs';
import type { ComponentManifest, CoreDocgenComponent, CoreMdxDoc, Doc, Story } from '../types.ts';

/**
 * Adapts Storybook's `experimentalDocgenServer` open-service payloads (the "core
 * format") into `@storybook/mcp`'s internal {@link ComponentManifest}/{@link Doc}
 * shapes. This is the single place that bridges the two formats, used by both the
 * ref-resolution path (built/static/remote manifests) and the addon's in-process
 * `resolveEntry` hook (dev).
 *
 * The implementation lives in Storybook core (`storybook/internal/toolsets-docs`,
 * bundled into this package's dist). These delegates keep this package's structural
 * `Core*` parameter types — the wire contract also exported from `./types.ts` — because
 * core types its equivalent directly against the service payload types, which are
 * narrower (e.g. `subcomponents`) than the structural declarations here.
 */

/** Converts the story-docs `stories` record (or an already-resolved array) into `Story[]`. */
export function adaptCoreStories(stories: CoreDocgenComponent['stories']): Story[] | undefined {
  return sharedAdaptCoreStories(stories);
}

/** Adapts one MDX service payload into a {@link Doc}. */
export function adaptCoreDoc(doc: CoreMdxDoc): Doc {
  return sharedAdaptCoreDoc(doc);
}

/** Adapts a core-format component (docgen + story-docs + attached MDX) into a {@link ComponentManifest}. */
export function adaptCoreComponent(core: CoreDocgenComponent): ComponentManifest {
  return sharedAdaptCoreComponent(core as SharedCoreDocgenComponent);
}
