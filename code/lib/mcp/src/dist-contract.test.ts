/**
 * Guards what this package ships.
 *
 * `@storybook/mcp` serves hosted Storybooks and must stay installable without Storybook itself, so
 * the shared formatter it imports from core is bundled rather than depended on. Both halves of that
 * bargain are easy to break silently — an unbundled import would fail at a consumer's runtime, and
 * tree-shaking regressions only show up as a bigger tarball — so both are asserted here.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import packageJson from '../package.json' with { type: 'json' };

const DIST_ENTRY = join(import.meta.dirname, '../dist/index.js');

/**
 * Headroom over the current size, so ordinary edits pass but a bundling regression does not.
 *
 * The budget stepped up when this package moved from shipping its own docs tools to bundling
 * Storybook's shared docs toolset — the engine it used to duplicate now arrives from core.
 */
const SIZE_BUDGET_BYTES = 80_000;

describe('published package contract', () => {
  it('declares no runtime dependency on storybook', () => {
    const manifest = packageJson as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(Object.keys(manifest.dependencies ?? {})).not.toContain('storybook');
    expect(Object.keys(manifest.peerDependencies ?? {})).not.toContain('storybook');
    expect(Object.keys(manifest.devDependencies ?? {})).toContain('storybook');
  });

  it.runIf(existsSync(DIST_ENTRY))('bundles what it imports from storybook', () => {
    expect(readFileSync(DIST_ENTRY, 'utf-8')).not.toMatch(
      /from\s*["']storybook\/|require\(["']storybook\//
    );
  });

  it.runIf(existsSync(DIST_ENTRY))('stays within its size budget', () => {
    expect(statSync(DIST_ENTRY).size).toBeLessThan(SIZE_BUDGET_BYTES);
  });
});
