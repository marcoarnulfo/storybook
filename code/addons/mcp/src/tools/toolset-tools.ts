/**
 * Adapter from core's public toolsets to MCP tools.
 *
 * Everything an MCP client can observe stays here — the frozen tool names, the transport, the
 * session, and the app resource — while the data, prose and telemetry payloads come from the
 * toolset the method belongs to.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';
import { getService } from 'storybook/internal/core-server';
import {
  OpenServiceModuleGraphUnavailableError,
  OpenServiceToolsetOutputMismatchError,
} from 'storybook/internal/server-errors';
import {
  MCP_TOOL_NAMES,
  MCP_TOOL_TITLES,
  getToolset,
  resolveToolsetDescription,
  type AnyToolsetOutcome,
  type ToolsetCtx,
  type ToolsetMethod,
  type ToolsetMethodRef,
} from 'storybook/open-service';
import type { McpServer } from 'tmcp';

import { collectTelemetry } from '../telemetry.ts';
import type { AddonContext } from '../types.ts';
import { errorToMCPContent } from '../utils/errors.ts';
import type { StorybookAiToolCallResult } from './tool-registry.ts';

type Server = McpServer<any, AddonContext>;
type ToolEnabled = Parameters<Server['tool']>[0]['enabled'];

/** Which toolset an MCP tool's telemetry is grouped under. */
export type TelemetryToolset = 'dev' | 'test' | 'docs';

export type ToolsetToolOptions = {
  /** Which toolset method backs this MCP tool. */
  method: ToolsetMethodRef;
  /** Telemetry grouping for this tool's events. */
  telemetryToolset: TelemetryToolset;
  /** Extra MCP-only tool metadata, e.g. the preview app resource. */
  extras?: Record<string, unknown>;
  /** Wraps the input schema before publishing it (used for friendlier validation errors). */
  wrapSchema?: (schema: StandardSchemaV1) => StandardSchemaV1;
  /**
   * Origin to run the method against. Defaults to the addon's trusted origin; the review tool
   * derives a request-relative root so a sub-path-hosted Storybook links to its own review page.
   */
  resolveOrigin?: (server: Server) => string | undefined;
  /**
   * Supplies the method instead of the registry.
   *
   * A composition's docs tools read state that belongs to the request being served (its manifest
   * provider and composed sources), so their toolset is built per call rather than registered once
   * at boot. Called without a server when only static metadata is needed.
   */
  resolveMethod?: (server?: Server) => ToolsetMethod<any, AnyToolsetOutcome>;
};

function resolveMethod(
  options: ToolsetToolOptions,
  server?: Server
): ToolsetMethod<any, AnyToolsetOutcome> {
  if (options.resolveMethod) {
    return options.resolveMethod(server);
  }
  const [toolsetId, methodName] = options.method.split('.');
  return getToolset(toolsetId).methods[methodName];
}

/**
 * Narrows outcome data to the published output contract.
 *
 * Outcomes may carry more data than the contract declares (the rendered Markdown needs it); only
 * the declared shape reaches `structuredContent`.
 */
async function toStructuredContent(
  outputSchema: StandardSchemaV1 | undefined,
  data: unknown
): Promise<Record<string, unknown> | undefined> {
  if (!outputSchema || data === undefined || data === null) {
    return undefined;
  }
  const result = await outputSchema['~standard'].validate(data);
  if (result.issues) {
    throw new OpenServiceToolsetOutputMismatchError({ issues: result.issues });
  }
  return result.value as Record<string, unknown>;
}

function buildContext(server: Server, options: ToolsetToolOptions): ToolsetCtx {
  const custom = server.ctx.custom;
  return {
    consumer: 'mcp',
    origin: options.resolveOrigin?.(server) ?? custom?.origin,
    getService: (serviceId, serviceOptions) => getService(serviceId as any, serviceOptions) as any,
    telemetry: custom?.disableTelemetry
      ? undefined
      : async (event, payload) => {
          await collectTelemetry({
            event,
            server,
            toolset: options.telemetryToolset,
            ...payload,
          });
        },
  };
}

/** Runs one toolset method and unwraps its outcome into an MCP tool result. */
export async function callToolsetMethod(
  server: Server,
  options: ToolsetToolOptions,
  input: unknown
): Promise<StorybookAiToolCallResult> {
  const method = resolveMethod(options, server);
  const ctx = buildContext(server, options);

  try {
    const outcome = await method.handler(input as never, ctx);
    const structuredContent = await toStructuredContent(method.outputSchema, outcome.data);
    const blocks = Array.isArray(outcome.markdown) ? outcome.markdown : [outcome.markdown];

    return {
      content: blocks.map((text) => ({ type: 'text' as const, text })),
      ...(structuredContent ? { structuredContent } : {}),
      ...(outcome.ok ? {} : { isError: true }),
    };
  } catch (error) {
    // This one is written for the agent that triggered the lookup and names its own recovery, so
    // it is surfaced as-is instead of being wrapped as an unexpected failure.
    if (error instanceof OpenServiceModuleGraphUnavailableError) {
      return { content: [{ type: 'text', text: error.message }], isError: true };
    }
    return errorToMCPContent(error);
  }
}

/** Metadata for one toolset-backed MCP tool, with the frozen name and title. */
export function getToolsetToolMetadata(options: ToolsetToolOptions) {
  const method = resolveMethod(options);
  const descriptionCtx: ToolsetCtx = {
    consumer: 'mcp',
    getService: (serviceId, serviceOptions) => getService(serviceId as any, serviceOptions) as any,
  };

  // A zero-input method publishes no input schema, matching the hand-written tools it replaced.
  const entries = (method.schema as { entries?: Record<string, unknown> }).entries;
  const hasInput = !entries || Object.keys(entries).length > 0;

  return {
    name: MCP_TOOL_NAMES[options.method],
    title: MCP_TOOL_TITLES[options.method],
    description: resolveToolsetDescription(method.description, descriptionCtx),
    ...(hasInput
      ? { schema: options.wrapSchema ? options.wrapSchema(method.schema) : method.schema }
      : {}),
    ...(method.outputSchema ? { outputSchema: method.outputSchema } : {}),
    ...options.extras,
  };
}

/** Registers one toolset-backed MCP tool. */
export function registerToolsetTool(
  server: Server,
  options: ToolsetToolOptions,
  enabled: ToolEnabled
): void {
  // tmcp types the handler from the literal schema generic; toolset schemas resolve at runtime,
  // so both sides step out of that inference.
  server.tool(
    { ...getToolsetToolMetadata(options), enabled } as never,
    ((input: unknown) => callToolsetMethod(server, options, input)) as never
  );
}
