import { describe, expect, it, vi } from 'vitest';

import type { DocsAccess } from './access.ts';
import { createMultiSourceDocsAccess } from './access-multi-source.ts';

const stubAccess = (access: Partial<DocsAccess>): DocsAccess => ({
  list: async () => ({ componentManifest: { v: 1, components: {} } }),
  resolve: async () => undefined,
  ...access,
});

const local = stubAccess({
  list: async () => ({
    componentManifest: {
      v: 1,
      components: {
        button: { id: 'button', name: 'Local Button' },
        card: { id: 'card', name: 'Card' },
      },
    },
    docsManifest: { v: 1, docs: { 'guide--docs': { id: 'guide--docs', name: 'Local guide' } } },
  }),
  resolve: async (id) =>
    id === 'button'
      ? { kind: 'component', component: { id: 'button', name: 'Local Button' } }
      : undefined,
});

const remote = stubAccess({
  list: async () => ({
    componentManifest: {
      v: 1,
      components: {
        button: { id: 'button', name: 'Remote Button' },
        badge: { id: 'badge', name: 'Badge' },
      },
    },
    docsManifest: { v: 1, docs: { 'intro--docs': { id: 'intro--docs', name: 'Intro' } } },
  }),
  resolve: async (id) =>
    id === 'badge' ? { kind: 'component', component: { id: 'badge', name: 'Badge' } } : undefined,
});

const broken = stubAccess({
  list: async () => {
    throw new Error('source unreachable');
  },
});

describe('createMultiSourceDocsAccess list', () => {
  it('merges every source, keeping source order and letting the first definition win', async () => {
    const manifests = await createMultiSourceDocsAccess([
      { id: 'local', access: local },
      { id: 'remote', access: remote },
    ]).list({ withStoryIds: false });

    expect(Object.keys(manifests.componentManifest.components)).toEqual([
      'button',
      'card',
      'badge',
    ]);
    expect(manifests.componentManifest.components.button).toEqual({
      id: 'button',
      name: 'Local Button',
    });
    expect(Object.keys(manifests.docsManifest?.docs ?? {})).toEqual(['guide--docs', 'intro--docs']);
  });

  it('skips a failing source instead of failing the whole listing', async () => {
    const manifests = await createMultiSourceDocsAccess([
      { id: 'broken', access: broken },
      { id: 'remote', access: remote },
    ]).list({ withStoryIds: false });

    expect(Object.keys(manifests.componentManifest.components)).toEqual(['button', 'badge']);
    expect(manifests.componentManifest.components.button).toEqual({
      id: 'button',
      name: 'Remote Button',
    });
  });

  it('returns an empty listing when every source fails', async () => {
    await expect(
      createMultiSourceDocsAccess([{ id: 'broken', access: broken }]).list({ withStoryIds: false })
    ).resolves.toEqual({ componentManifest: { v: 1, components: {} } });
  });

  it('omits the docs manifest when no source contributed standalone docs', async () => {
    const manifests = await createMultiSourceDocsAccess([
      { id: 'bare', access: stubAccess({}) },
    ]).list({ withStoryIds: false });

    expect(manifests.docsManifest).toBeUndefined();
  });

  it('passes the listing options through to every source', async () => {
    const list = vi.fn(async () => ({ componentManifest: { v: 1 as const, components: {} } }));

    await createMultiSourceDocsAccess([{ id: 'spy', access: stubAccess({ list }) }]).list({
      withStoryIds: true,
    });

    expect(list).toHaveBeenCalledWith({ withStoryIds: true });
  });
});

describe('createMultiSourceDocsAccess resolve', () => {
  it('returns the first hit and stops asking later sources', async () => {
    const remoteResolve = vi.fn(remote.resolve);

    const entry = await createMultiSourceDocsAccess([
      { id: 'local', access: local },
      { id: 'remote', access: stubAccess({ resolve: remoteResolve }) },
    ]).resolve('button');

    expect(entry).toEqual({ kind: 'component', component: { id: 'button', name: 'Local Button' } });
    expect(remoteResolve).not.toHaveBeenCalled();
  });

  it('falls through to later sources for ids the first one does not have', async () => {
    const entry = await createMultiSourceDocsAccess([
      { id: 'local', access: local },
      { id: 'remote', access: remote },
    ]).resolve('badge');

    expect(entry).toEqual({ kind: 'component', component: { id: 'badge', name: 'Badge' } });
  });

  it('returns undefined when no source knows the id', async () => {
    await expect(
      createMultiSourceDocsAccess([
        { id: 'local', access: local },
        { id: 'remote', access: remote },
      ]).resolve('nope')
    ).resolves.toBeUndefined();
  });
});
