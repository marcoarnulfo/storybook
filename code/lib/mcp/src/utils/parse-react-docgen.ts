import type { Documentation } from 'react-docgen';
import type { ComponentDoc } from 'react-docgen-typescript';
import {
  parseReactComponentMeta as sharedParseReactComponentMeta,
  parseReactDocgen as sharedParseReactDocgen,
  parseReactDocgenTypescript as sharedParseReactDocgenTypescript,
  type ParsedDocgen,
} from 'storybook/internal/toolsets-docs';

export type { ParsedDocgen };

/**
 * The parsers live in Storybook core (`storybook/internal/toolsets-docs`, bundled into this
 * package's dist), where they are typed against structural subsets of the docgen output. These
 * delegates keep this package's original `react-docgen` / `react-docgen-typescript` parameter
 * types (both type-only dev dependencies), which are wider than the structural subsets the
 * parsers read.
 */

// Storybook's `reactComponentMeta` payload is not the same full schema as
// `react-docgen-typescript`'s `ComponentDoc`, but `props` has the same type shape.
type ComponentDocLike = Pick<ComponentDoc, 'props'>;

export const parseReactDocgen = (reactDocgen: Documentation): ParsedDocgen =>
  sharedParseReactDocgen(reactDocgen as Parameters<typeof sharedParseReactDocgen>[0]);

export const parseReactDocgenTypescript = (reactDocgenTypescript: ComponentDoc): ParsedDocgen =>
  sharedParseReactDocgenTypescript(
    reactDocgenTypescript as Parameters<typeof sharedParseReactDocgenTypescript>[0]
  );

export const parseReactComponentMeta = (reactComponentMeta: ComponentDocLike): ParsedDocgen =>
  sharedParseReactComponentMeta(
    reactComponentMeta as Parameters<typeof sharedParseReactComponentMeta>[0]
  );
