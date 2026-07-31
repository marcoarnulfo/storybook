import { describe, expect, it } from 'vitest';

import type { ToolsetCtx } from '../../toolset-definition.ts';
import type { DocsAccess } from './access.ts';
import { createDocsToolset } from './definition.ts';

const button = {
  id: 'button',
  name: 'Button',
  description: 'Click me',
  summary: 'A button',
  stories: [{ id: 'button--primary', name: 'Primary', snippet: '<Button />' }],
  import: "import { Button } from './Button'",
};

const guide = { id: 'guide--docs', name: 'Guide', summary: 'How to' };

/** Fake access: the seam exists precisely so the toolset is testable without services. */
const docsAccess: DocsAccess = {
  list: async ({ withStoryIds }) => ({
    componentManifest: {
      v: 1,
      components: {
        button: {
          id: 'button',
          name: 'Button',
          summary: 'A button',
          ...(withStoryIds ? { stories: button.stories } : {}),
        },
      },
    },
    docsManifest: { v: 1, docs: { 'guide--docs': guide } },
  }),
  resolve: async (id) => {
    if (id === 'button') {
      return { kind: 'component', component: button };
    }
    if (id === 'guide--docs') {
      return { kind: 'doc', doc: guide };
    }
    return undefined;
  },
};

const toolset = createDocsToolset({ docsAccess });

const mcpCtx: ToolsetCtx = { consumer: 'mcp', getService: () => ({}) as never };
const cliCtx: ToolsetCtx = { consumer: 'cli', getService: () => ({}) as never };

describe('docs.list', () => {
  it('returns the manifests from the access and renders the list Markdown', async () => {
    const data = await toolset.methods.list.handler({ withStoryIds: false });

    expect(Object.keys(data.manifests!.componentManifest.components)).toEqual(['button']);

    const text = toolset.methods.list.format(data);
    expect(text).toContain('button');
    expect(text).toContain('Guide');
    expect(text).not.toContain('button--primary');
  });

  it('includes story ids only when requested', async () => {
    const data = await toolset.methods.list.handler({ withStoryIds: true });

    expect(toolset.methods.list.format(data)).toContain('button--primary');
  });

  it('cross-references the show tool per consumer in its description', () => {
    const describe_ = toolset.methods.list.description;
    const resolved = typeof describe_ === 'function' ? describe_(mcpCtx) : describe_;
    const resolvedCli = typeof describe_ === 'function' ? describe_(cliCtx) : describe_;

    expect(resolved).toContain('get-documentation');
    expect(resolvedCli).toContain('npx storybook tools docs show');
  });
});

describe('docs.show', () => {
  it('renders component documentation for a known component id', async () => {
    const data = await toolset.methods.show.handler({ id: 'button' }, mcpCtx);

    expect(data.entry?.kind).toBe('component');
    expect(toolset.methods.show.format(data, mcpCtx)).toContain('Button');
  });

  it('renders standalone docs entries', async () => {
    const data = await toolset.methods.show.handler({ id: 'guide--docs' }, mcpCtx);

    expect(data.entry?.kind).toBe('doc');
    expect(toolset.methods.show.format(data, mcpCtx)).toContain('Guide');
  });

  it('answers unknown ids with the @storybook/mcp miss message on MCP', async () => {
    const data = await toolset.methods.show.handler({ id: 'nope' }, mcpCtx);

    expect(data.entry).toBeUndefined();
    expect(toolset.methods.show.format(data, mcpCtx)).toBe(
      'Component or Docs Entry not found: "nope". Use the list-all-documentation tool to see available components and documentation entries.'
    );
    expect(toolset.methods.show.format(data, cliCtx)).toBe(
      'Component or Docs Entry not found: "nope".'
    );
  });
});

describe('docs.showStory', () => {
  it('renders the story documentation for a known story name', async () => {
    const data = await toolset.methods.showStory.handler(
      {
        componentId: 'button',
        storyName: 'Primary',
      },
      mcpCtx
    );

    expect(toolset.methods.showStory.format(data, mcpCtx)).toContain('<Button />');
  });

  it('lists available stories when the story name misses', async () => {
    const data = await toolset.methods.showStory.handler(
      {
        componentId: 'button',
        storyName: 'Missing',
      },
      mcpCtx
    );

    expect(toolset.methods.showStory.format(data, mcpCtx)).toBe(
      'Story "Missing" not found for component "button". Available stories: Primary'
    );
  });

  it('answers unknown components with the miss message per consumer', async () => {
    const data = await toolset.methods.showStory.handler(
      {
        componentId: 'nope',
        storyName: 'Primary',
      },
      mcpCtx
    );

    expect(toolset.methods.showStory.format(data, mcpCtx)).toBe(
      'Component not found: "nope". Use the list-all-documentation tool to see available components.'
    );
    expect(toolset.methods.showStory.format(data, cliCtx)).toBe('Component not found: "nope".');
  });
});

describe('usage reporting', () => {
  /** Runs a method end-to-end the way a consumer does: handler, format, then reportUsage. */
  async function run(methodName: 'list' | 'show', input: unknown, consumer: 'cli' | 'mcp') {
    const events: Array<[string, Record<string, unknown>]> = [];
    const ctx: ToolsetCtx = {
      consumer,
      getService: () => ({}) as never,
      telemetry: async (event, payload) => {
        events.push([event, payload]);
      },
    };

    const method = toolset.methods[methodName];
    const data = await method.handler(input as never, ctx);
    const formatted = method.format(data as never, ctx);
    const text = Array.isArray(formatted) ? formatted.join('\n') : formatted;
    await method.reportUsage?.({ input: input as never, data: data as never, text }, ctx);

    return events;
  }

  it.each(['cli', 'mcp'] as const)('reports a listing on %s', async (consumer) => {
    const [[event, payload] = []] = await run('list', { withStoryIds: false }, consumer);

    expect(event).toBe('tool:listAllDocumentation');
    expect(payload).toMatchObject({ componentCount: 1, docsCount: 1 });
    expect(payload!.resultTokenCount).toBeGreaterThan(0);
  });

  it.each(['cli', 'mcp'] as const)('reports a lookup on %s', async (consumer) => {
    const [[event, payload] = []] = await run('show', { id: 'button' }, consumer);

    expect(event).toBe('tool:getDocumentation');
    expect(payload).toMatchObject({ componentId: 'button', found: true });
  });

  it('reports a miss as not found', async () => {
    const [[, payload] = []] = await run('show', { id: 'nope' }, 'mcp');

    expect(payload).toMatchObject({ componentId: 'nope', found: false });
  });
});
