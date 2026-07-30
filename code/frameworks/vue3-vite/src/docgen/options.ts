import type { Options } from 'storybook/internal/types';

import type { FrameworkOptions, VueDocgenPlugin } from '../types.ts';

export type ResolvedDocgenOptions = false | { plugin: VueDocgenPlugin; tsconfig?: string };

export async function getFrameworkOptions(options: Options): Promise<FrameworkOptions> {
  const framework = await options.presets.apply('framework');
  return typeof framework === 'string' ? {} : (framework.options ?? {});
}

export function resolveDocgenOptions(docgen?: FrameworkOptions['docgen']): ResolvedDocgenOptions {
  if (docgen === false) {
    return false;
  }

  if (docgen === undefined || docgen === true) {
    return { plugin: 'vue-docgen-api' };
  }

  if (typeof docgen === 'string') {
    return { plugin: docgen };
  }

  return docgen;
}

/** Where docgen extraction runs, resolved once for every caller that branches on it. */
interface DocgenSetup {
  docgen: ResolvedDocgenOptions;
  /**
   * Whether the docgen service owns extraction. Only vue-component-meta has a worker-side
   * extractor, so a project on vue-docgen-api keeps the build-time Vite plugin even with
   * `experimentalDocgenServer` enabled.
   *
   * This is the single condition behind the provider, the components manifest, and the Vite plugin.
   * Deriving them independently risks a config where the plugin is stripped and no provider is
   * registered, which is silently no docgen at all.
   */
  usesDocgenService: boolean;
}

export async function resolveDocgenSetup(options: Options): Promise<DocgenSetup> {
  const [frameworkOptions, features] = await Promise.all([
    getFrameworkOptions(options),
    options.presets.apply('features', {}),
  ]);
  const docgen = resolveDocgenOptions(frameworkOptions.docgen);

  return {
    docgen,
    usesDocgenService:
      !!features?.experimentalDocgenServer &&
      docgen !== false &&
      docgen.plugin === 'vue-component-meta',
  };
}
