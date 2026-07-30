import { OpenServiceModuleGraphUnavailableError } from 'storybook/internal/server-errors';
import { clearToolsetRegistry, defineToolset, registerToolset } from 'storybook/open-service';
import * as v from 'valibot';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { callToolsetMethod, getToolsetToolMetadata } from './toolset-tools.ts';

vi.mock('storybook/internal/core-server', () => ({ getService: vi.fn() }));

const collectTelemetry = vi.hoisted(() => vi.fn());
vi.mock('../telemetry.ts', () => ({ collectTelemetry }));

/**
 * Stands in for the real `stories` toolset so these tests assert the adapter's contract — what an
 * MCP client sees — rather than any one method's behaviour.
 */
function registerStubStoriesToolset(
  overrides: {
    handler?: (input: unknown, ctx: any) => unknown;
  } = {}
) {
  registerToolset(
    defineToolset({
      id: 'stories',
      description: 'stub',
      methods: {
        preview: {
          schema: v.object({ id: v.string() }),
          outputSchema: v.object({ stories: v.array(v.object({ previewUrl: v.string() })) }),
          description: (ctx) => `describes ${ctx.consumer}`,
          handler:
            overrides.handler ??
            (async (input: { id: string }, ctx) => {
              await ctx.telemetry?.('tool:previewStories', { inputStoryCount: 1 });
              return {
                stories: [{ previewUrl: `${ctx.origin}/?path=/story/${input.id}` }],
                extraNotInContract: 'internal',
              };
            }),
          format: (data: any) => data.stories.map((s: any) => s.previewUrl).join('\n'),
        },
      },
    }) as any
  );
}

function makeServer(custom: Record<string, unknown> = {}) {
  return {
    ctx: { custom: { origin: 'http://localhost:6006', ...custom }, sessionId: 'session-1' },
  } as any;
}

const previewOptions = { method: 'stories.preview', telemetryToolset: 'dev' } as const;

describe('toolset-backed MCP tools', () => {
  beforeEach(() => {
    clearToolsetRegistry();
    collectTelemetry.mockClear();
  });

  afterEach(() => {
    clearToolsetRegistry();
  });

  it('publishes the frozen tool name and title with the mcp-resolved description', () => {
    registerStubStoriesToolset();

    const metadata = getToolsetToolMetadata(previewOptions);

    expect(metadata.name).toBe('preview-stories');
    expect(metadata.title).toBe('Get story preview URLs');
    expect(metadata.description).toBe('describes mcp');
  });

  it('returns formatted text and narrows structuredContent to the published output schema', async () => {
    registerStubStoriesToolset();

    const result = await callToolsetMethod(makeServer(), previewOptions, { id: 'button--primary' });

    expect(result.content).toEqual([
      { type: 'text', text: 'http://localhost:6006/?path=/story/button--primary' },
    ]);
    expect(result.structuredContent).toEqual({
      stories: [{ previewUrl: 'http://localhost:6006/?path=/story/button--primary' }],
    });
  });

  it('omits structuredContent when the method publishes no output schema', async () => {
    registerToolset(
      defineToolset({
        id: 'stories',
        description: 'stub',
        methods: {
          changed: {
            schema: v.object({}),
            description: 'changed',
            handler: async () => ({ stories: [] }),
            format: () => 'no changes',
          },
        },
      }) as any
    );

    const result = await callToolsetMethod(
      makeServer(),
      { method: 'stories.changed', telemetryToolset: 'dev' },
      {}
    );

    expect(result.content).toEqual([{ type: 'text', text: 'no changes' }]);
    expect(result.structuredContent).toBeUndefined();
  });

  it('runs the handler once, so a method with side effects cannot double-publish', async () => {
    const handler = vi.fn(async () => ({ stories: [{ previewUrl: 'http://localhost:6006/' }] }));
    registerStubStoriesToolset({ handler });

    await callToolsetMethod(makeServer(), previewOptions, { id: 'button--primary' });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('surfaces an unavailable module graph verbatim, without the generic error prefix', async () => {
    registerStubStoriesToolset({
      handler: () => {
        throw new OpenServiceModuleGraphUnavailableError({
          reason:
            "Storybook's story module graph hasn't built yet — it is still being constructed.",
        });
      },
    });

    const result = await callToolsetMethod(makeServer(), previewOptions, { id: 'x' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      "Storybook's story module graph hasn't built yet — it is still being constructed."
    );
  });

  it('wraps every other failure as an error result', async () => {
    registerStubStoriesToolset({
      handler: () => {
        throw new Error('boom');
      },
    });

    const result = await callToolsetMethod(makeServer(), previewOptions, { id: 'x' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Error: boom');
  });

  it('forwards method telemetry with the surface fields the adapter owns', async () => {
    registerStubStoriesToolset();

    await callToolsetMethod(makeServer(), previewOptions, { id: 'button--primary' });

    expect(collectTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'tool:previewStories',
        toolset: 'dev',
        inputStoryCount: 1,
      })
    );
  });

  it('emits no telemetry when the session disabled it', async () => {
    registerStubStoriesToolset();

    await callToolsetMethod(makeServer({ disableTelemetry: true }), previewOptions, {
      id: 'button--primary',
    });

    expect(collectTelemetry).not.toHaveBeenCalled();
  });

  it('lets a tool override the origin the method runs against', async () => {
    registerStubStoriesToolset();

    const result = await callToolsetMethod(
      makeServer(),
      { ...previewOptions, resolveOrigin: () => 'http://localhost:6006/nested' },
      { id: 'button--primary' }
    );

    expect(result.content[0].text).toBe(
      'http://localhost:6006/nested/?path=/story/button--primary'
    );
  });
});
