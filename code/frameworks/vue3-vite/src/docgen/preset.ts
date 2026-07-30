import { fileURLToPath } from 'node:url';

import type {
  DocgenProviderDescriptor,
  IndexEntry,
  Options,
  PresetPropertyFn,
  StorybookConfigRaw,
} from 'storybook/internal/types';

import { resolveDocgenSetup } from './options.ts';

/**
 * Vue docgen provider.
 *
 * Contributes a {@link DocgenProviderDescriptor} pointing at
 * `@storybook/vue3/internal/docgen-worker`, which core's docgen worker imports and runs off the
 * main thread. The framework contributes it rather than the renderer — unlike React — because the
 * engine is chosen by `framework.options.docgen`, which only the framework can read.
 *
 * Registered only for the vue-component-meta engine: vue-docgen-api has no worker-side extractor,
 * and `docgen: false` disables extraction entirely. Core only applies this preset when
 * `experimentalDocgenServer` is on, so the feature itself is checked in {@link resolveDocgenSetup}
 * purely to keep that decision in one place.
 *
 * The descriptor is appended to the accumulated array so addon providers can stack on top.
 */
export const experimental_docgenProvider = async (
  existing: DocgenProviderDescriptor[] = [],
  options: Options
): Promise<DocgenProviderDescriptor[]> => {
  const { usesDocgenService } = await resolveDocgenSetup(options);

  if (!usesDocgenService) {
    return existing;
  }

  return [
    ...existing,
    {
      moduleSpecifier: fileURLToPath(import.meta.resolve('@storybook/vue3/internal/docgen-worker')),
    },
  ];
};

/**
 * Declares that vue-component-meta produced the metadata, for the components HTML debugger.
 *
 * Core reads `components.meta.docgen` through `experimental_manifests` rather than inferring it,
 * and asserts it is present once `experimentalDocgenServer` and `componentsManifest` are both on.
 * Contributed only when the docgen service actually owns extraction: the manifest is populated from
 * service payloads, so naming an engine that never produced any would report "0 components" against
 * it.
 *
 * The `components` map stays empty — payloads live in the open service and core merges them in by
 * id. Vue has no legacy component manifest, so otherwise there is nothing to contribute and the
 * accumulated manifests pass straight through.
 */
export const experimental_manifests: PresetPropertyFn<
  'experimental_manifests',
  StorybookConfigRaw,
  { manifestEntries: IndexEntry[]; watch: boolean }
> = async (existingManifests = {}, options) => {
  const { usesDocgenService } = await resolveDocgenSetup(options);

  if (!usesDocgenService) {
    return existingManifests;
  }

  return {
    ...existingManifests,
    components: {
      v: 0,
      components: {},
      meta: { docgen: 'vue-component-meta', durationMs: 0 },
    },
  };
};
