import type { DocgenPayload } from '../../services/docgen/types.ts';
import type { StoryDocsPayload } from '../../services/story-docs/types.ts';
import type { MdxPayload } from './map.ts';

export type DocsClassification = {
  /** Component ids present in docgen and/or story-docs aggregates. */
  componentIds: string[];
  /** Component ids backed by a story-docs payload. */
  storyBasedIds: Set<string>;
  /** Standalone MDX docs keyed by docs id → display name. */
  unattachedDocs: Map<string, string>;
  /** Attached MDX docs ids grouped by owning component id. */
  attachedDocsByComponent: Map<string, string[]>;
};

/**
 * Visibility intentionally follows composed service payloads because this API has no story-index
 * dependency with which to reapply manifest filtering.
 */
