import {
  extractDocsSummary,
  formatManifestsToLists as sharedFormatManifestsToLists,
  MAX_SUMMARY_LENGTH,
  type AllManifests as SharedAllManifests,
} from 'storybook/internal/toolsets-docs';
import type {
  AllManifests,
  ComponentManifestEntry,
  DocEntry,
  SourceManifests,
  Story,
} from '../../types.ts';
import { formatRequiresOwnMcpNotice } from '../requires-own-mcp.ts';

/**
 * The single-source formatters live in Storybook core (`storybook/internal/toolsets-docs`,
 * bundled into this package's dist). This module keeps what has no core counterpart: the
 * multi-source composition formatter, and a delegate typed against this package's wire-format
 * manifest types (whose split/ref v1 rows carry `$ref`s that core's in-process types don't).
 */

type ListFormattingOptions = {
  withStoryIds?: boolean;
};

function formatComponentLine(component: ComponentManifestEntry): string {
  const summary =
    component.summary ??
    (component.description
      ? component.description.length > MAX_SUMMARY_LENGTH
        ? `${component.description.slice(0, MAX_SUMMARY_LENGTH)}...`
        : component.description
      : undefined);

  if (summary) {
    return `- ${component.name} (${component.id}): ${summary}`;
  }
  return `- ${component.name} (${component.id})`;
}

function formatDocLine(doc: DocEntry): string {
  // `title`/`content` only exist on inline (v0) docs; v1 index rows carry just a summary.
  const title = 'title' in doc ? doc.title : undefined;
  const content = 'content' in doc ? doc.content : undefined;
  const summary = doc.summary ?? extractDocsSummary(content ?? '');
  return `- ${title ?? doc.name} (${doc.id})${summary ? `: ${summary}` : ''}`;
}

function formatStorySubLine(story: Story): string {
  return `  - ${story.name}` + (story.id ? ` (${story.id})` : '');
}

/**
 * Format a component manifest map into a markdown list.
 * @param manifest - The component manifest map to format
 * @returns Formatted string representation of the component list
 */
export function formatManifestsToLists(
  manifests: AllManifests,
  options: ListFormattingOptions = {}
): string {
  // Safe: v1 index rows here carry `$ref`s where core's in-process rows carry resolved values,
  // which the formatter's `Array.isArray` / `in` guards already skip; the shapes it reads are
  // identical.
  return sharedFormatManifestsToLists(manifests as unknown as SharedAllManifests, options);
}

export function formatMultiSourceManifestsToLists(
  manifests: SourceManifests[],
  options: ListFormattingOptions = {}
): string {
  const parts: string[] = [];

  for (const { source, componentManifest, docsManifest, error, notice } of manifests) {
    parts.push(`# ${source.title}`);
    parts.push(`id: ${source.id}`);
    parts.push('');

    if (error) {
      parts.push(`error: ${error}`);
      parts.push('');
      continue;
    }

    if (notice) {
      parts.push(formatRequiresOwnMcpNotice(source, notice.endpoint, { includeHeader: false }));
      parts.push('');
      continue;
    }

    const components = Object.values(componentManifest.components);
    if (components.length > 0) {
      parts.push('## Components');
      parts.push('');
      for (const component of components) {
        parts.push(formatComponentLine(component));
        if (options.withStoryIds && Array.isArray(component.stories)) {
          for (const story of component.stories) {
            parts.push(formatStorySubLine(story));
          }
        }
      }
      parts.push('');
    }

    if (docsManifest && Object.keys(docsManifest.docs).length > 0) {
      parts.push('## Docs');
      parts.push('');
      for (const doc of Object.values(docsManifest.docs)) {
        parts.push(formatDocLine(doc));
      }
      parts.push('');
    }
  }

  return parts.join('\n').trim();
}
