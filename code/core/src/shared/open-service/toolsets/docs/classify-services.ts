/** What the docs services expose about a project, as `createServiceDocsAccess` reads it. */
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
