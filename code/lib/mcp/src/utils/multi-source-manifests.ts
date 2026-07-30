/**
 * The package's published multi-source manifest API.
 *
 * The docs tools no longer go through this — they read composed sources through the shared toolset
 * — but embedders import it directly, so it stays part of the public surface with its original
 * signature and flat result shape.
 */

import {
  createCompositionDocsSources,
  listSources,
  type ManifestProvider,
  type Source,
} from 'storybook/internal/toolsets-docs';

import type { SourceManifests } from '../types.ts';

/**
 * Fetches every source's manifests, capturing a failure as that source's own outcome rather than
 * losing the whole listing. Throws only when no source produced anything usable.
 */
export async function getMultiSourceManifests(
  sources: Source[],
  request?: Request,
  manifestProvider?: ManifestProvider
): Promise<SourceManifests[]> {
  const listings = await listSources(
    createCompositionDocsSources({ sources, manifestProvider, getRequest: () => request }),
    { withStoryIds: false }
  );

  return listings.map(({ source, manifests, error, notice }) => ({
    source,
    componentManifest: manifests?.componentManifest ?? { v: 1 as const, components: {} },
    ...(manifests?.docsManifest ? { docsManifest: manifests.docsManifest } : {}),
    ...(error ? { error } : {}),
    ...(notice ? { notice } : {}),
  }));
}
