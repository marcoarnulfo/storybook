/**
 * Docs access backed by the manifests core builds itself (the default mode, with
 * `experimentalDocgenServer` off).
 *
 * Those manifests are fully inline: component rows carry their docgen, stories, and attached MDX
 * content, and standalone docs carry their MDX content. `$ref` indirection only appears in
 * docgen-server mode, which `createServiceDocsAccess` covers instead — so listing and resolving are
 * plain lookups here.
 *
 * The loader is injected because the manifests are assembled in `core-server`, which the docs
 * toolset must not import.
 */

import { emptyManifests, type DocsAccess, type ResolvedDocsEntry } from './access.ts';
import type {
  AllManifests,
  ComponentManifestEntry,
  ComponentManifestMap,
  DocEntry,
  DocsManifestMap,
} from './manifest-formatter/manifest-types.ts';

/** The manifests as they leave core's manifest builder, before any shape is assumed. */
export type RawManifests = {
  components?: unknown;
  docs?: unknown;
};

export type ManifestDocsAccessOptions = {
  getManifests: () => Promise<RawManifests>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Anything other than an explicit `v: 1` is the inline (v0) format. */
function isShallow(manifest: Record<string, unknown>): boolean {
  return manifest.v === 1;
}

function toComponentManifest(value: unknown): ComponentManifestMap | undefined {
  if (!isRecord(value) || !isRecord(value.components)) {
    return undefined;
  }
  const components = value.components as Record<string, ComponentManifestEntry>;
  return isShallow(value) ? { v: 1, components } : { v: 0, components };
}

function toDocsManifest(value: unknown): DocsManifestMap | undefined {
  if (!isRecord(value) || !isRecord(value.docs)) {
    return undefined;
  }
  const docs = value.docs as Record<string, DocEntry>;
  return isShallow(value) ? { v: 1, docs } : { v: 0, docs };
}

/**
 * Inline manifests always carry their stories. `list` promises story ids only when they were asked
 * for, so drop them otherwise and keep the listing shape identical across access implementations.
 */
function withoutStories(manifest: ComponentManifestMap): ComponentManifestMap {
  const components = Object.fromEntries(
    Object.entries(manifest.components).map(([id, { stories: _stories, ...rest }]) => [id, rest])
  );
  return manifest.v === 1 ? { v: 1, components } : { v: 0, components };
}

export function createManifestDocsAccess({ getManifests }: ManifestDocsAccessOptions): DocsAccess {
  return {
    async list({ withStoryIds }): Promise<AllManifests> {
      const raw = await getManifests();
      const componentManifest = toComponentManifest(raw.components);
      const docsManifest = toDocsManifest(raw.docs);

      return {
        ...emptyManifests(),
        ...(componentManifest
          ? {
              componentManifest: withStoryIds
                ? componentManifest
                : withoutStories(componentManifest),
            }
          : {}),
        ...(docsManifest ? { docsManifest } : {}),
      };
    },

    async resolve(id): Promise<ResolvedDocsEntry | undefined> {
      const raw = await getManifests();

      const component = toComponentManifest(raw.components)?.components[id];
      if (component) {
        return { kind: 'component', component };
      }

      const doc = toDocsManifest(raw.docs)?.docs[id];
      if (doc) {
        return { kind: 'doc', doc };
      }

      return undefined;
    },
  };
}
