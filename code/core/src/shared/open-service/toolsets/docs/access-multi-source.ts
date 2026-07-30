/**
 * Fans one docs surface out over several sources — for example the local dev server plus one or
 * more composed Storybooks.
 *
 * Source order is the priority order: the first source that defines an id owns it.
 */

import { emptyManifests, type DocsAccess, type ResolvedDocsEntry } from './access.ts';
import type {
  AllManifests,
  ComponentManifestEntry,
  ComponentManifestMap,
  DocEntry,
  DocsManifestMap,
} from './manifest-formatter/manifest-types.ts';

export type DocsSource = {
  id: string;
  access: DocsAccess;
};

export function createMultiSourceDocsAccess(sources: DocsSource[]): DocsAccess {
  return {
    async list(options): Promise<AllManifests> {
      // Settled, not `all`: one unreachable source must cost its own entries, not the whole listing.
      const results = await Promise.allSettled(
        sources.map((source) => source.access.list(options))
      );

      const components: Record<string, ComponentManifestEntry> = {};
      const docs: Record<string, DocEntry> = {};
      let componentVersion: 0 | 1 | undefined;
      let docsVersion: 0 | 1 | undefined;

      for (const result of results) {
        if (result.status === 'rejected') {
          continue;
        }

        const { componentManifest, docsManifest } = result.value;
        componentVersion ??= componentManifest.v;
        for (const [id, component] of Object.entries(componentManifest.components)) {
          components[id] ??= component;
        }

        if (docsManifest) {
          docsVersion ??= docsManifest.v;
          for (const [id, doc] of Object.entries(docsManifest.docs)) {
            docs[id] ??= doc;
          }
        }
      }

      if (componentVersion === undefined && Object.keys(docs).length === 0) {
        return emptyManifests();
      }

      // Rows from different versions coexist: the formatters read them structurally, and the marker
      // follows the first source that produced one.
      const componentManifest: ComponentManifestMap =
        componentVersion === 0 ? { v: 0, components } : { v: 1, components };

      if (Object.keys(docs).length === 0) {
        return { componentManifest };
      }

      const docsManifest: DocsManifestMap = docsVersion === 0 ? { v: 0, docs } : { v: 1, docs };
      return { componentManifest, docsManifest };
    },

    async resolve(id): Promise<ResolvedDocsEntry | undefined> {
      for (const source of sources) {
        const entry = await source.access.resolve(id);
        if (entry) {
          return entry;
        }
      }
      return undefined;
    },
  };
}
