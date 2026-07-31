/**
 * Registry-level contracts: what survives when a backing toolset is broken, and how test-run
 * outcomes map onto the MCP `isError` flag. Both were regressions the e2e happy paths could not
 * see, so they are pinned here at the adapter seam.
 */

import { clearToolsetRegistry, defineToolset, registerToolset } from 'storybook/open-service';
import * as v from 'valibot';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerCoreToolsetsForTest } from '../test-support/register-core-toolsets.ts';
import { getAddonToolMetadata, registerAddonMcpTools } from './tool-registry.ts';

const collectTelemetry = vi.hoisted(() => vi.fn());
vi.mock('../telemetry.ts', () => ({ collectTelemetry }));

const loggerError = vi.hoisted(() => vi.fn());
vi.mock('storybook/internal/node-logger', () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function makeServer() {
  const tools = new Map<string, (input: unknown) => Promise<any>>();
  const server = {
    ctx: { custom: { origin: 'http://localhost:6006' }, sessionId: 'session-1' },
    tool: (metadata: { name: string }, handler: (input: unknown) => Promise<any>) => {
      tools.set(metadata.name, handler);
    },
    resource: () => {},
  } as any;

  return { server, tools };
}

describe('a broken tool row', () => {
  // The availability gate claims test support while the `test` toolset never registered — the
  // wiring bug behind the addon-vitest installed-but-not-enabled outage.
  const context = {
    availability: { testSupported: true, docsEnabled: true, a11yEnabled: false },
  } as never;

  beforeEach(() => {
    registerCoreToolsetsForTest({ testToolset: false });
    loggerError.mockClear();
  });

  it('is dropped from registration with an error log, keeping every other tool served', async () => {
    const { server, tools } = makeServer();

    await expect(registerAddonMcpTools(server, context)).resolves.toBeUndefined();

    expect([...tools.keys()]).not.toContain('run-story-tests');
    expect([...tools.keys()]).toEqual(
      expect.arrayContaining(['preview-stories', 'list-all-documentation', 'get-documentation'])
    );
    expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('run-story-tests'));
  });

  it('is dropped from the storybook ai metadata instead of failing the build', () => {
    const metadata = getAddonToolMetadata(context);
    const names = metadata.map((tool) => tool.name);

    expect(names).not.toContain('run-story-tests');
    expect(names).toEqual(expect.arrayContaining(['preview-stories', 'list-all-documentation']));
    expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('run-story-tests'));
  });

  it('contains only the missing-toolset case: any other adapter failure still fails fast', () => {
    registerToolset(
      defineToolset({
        id: 'test',
        description: 'stub',
        methods: {
          run: {
            schema: v.object({}),
            description: () => {
              throw new Error('broken description');
            },
            handler: async () => ({}),
            format: () => '',
          },
        },
      }) as any
    );

    expect(() => getAddonToolMetadata(context)).toThrow('broken description');
  });
});

describe('run-story-tests isError mapping', () => {
  // Availability narrowed so only rows whose toolsets are registered here resolve.
  const context = {
    availability: { testSupported: true, docsEnabled: false, a11yEnabled: false },
  } as never;

  function registerWithTestRun(handler: () => unknown) {
    registerCoreToolsetsForTest({ testToolset: false });
    registerToolset(
      defineToolset({
        id: 'test',
        description: 'stub',
        methods: {
          run: {
            schema: v.object({}),
            description: 'run',
            handler: async () => handler(),
            format: () => 'rendered run',
          },
        },
      }) as any
    );
  }

  async function callRun(handler: () => unknown) {
    registerWithTestRun(handler);
    const { server, tools } = makeServer();
    await registerAddonMcpTools(server, context);
    return tools.get('run-story-tests')!({});
  }

  beforeEach(() => {
    clearToolsetRegistry();
  });

  it('flags a crashed run as an error result', async () => {
    const result = await callRun(() => ({ status: 'error', error: { message: 'vitest died' } }));
    expect(result.isError).toBe(true);
  });

  it('flags a cancelled run as an error result', async () => {
    const result = await callRun(() => ({ status: 'cancelled' }));
    expect(result.isError).toBe(true);
  });

  it('keeps a completed run a success result', async () => {
    const result = await callRun(() => ({ status: 'completed', result: {} }));
    expect(result.isError).toBeUndefined();
  });

  it('keeps a timeout an error result via the throw path', async () => {
    const result = await callRun(() => {
      throw new Error('Test run timed out after 1800000ms');
    });
    expect(result.isError).toBe(true);
  });
});
