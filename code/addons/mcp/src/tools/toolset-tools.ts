/**
 * Adapter from core's public toolsets to MCP tools.
 *
 * Everything an MCP client can observe stays here — the frozen tool names, the transport, the
 * session, and the app resource — while the data, prose and telemetry payloads come from the
 * toolset the method belongs to.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';
import { getService } from 'storybook/internal/core-server';
import { OpenServiceModuleGraphUnavailableError } from 'storybook/internal/server-errors';
import {
  MCP_TOOL_NAMES,
  MCP_TOOL_TITLES,
  getToolset,
  resolveToolsetDescription,
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

/** Telemetry grouping for one tool, unchanged from the hand-written registrations. */
export type TelemetryToolset = 'dev' | 'test' | 'docs';

export type ToolsetToolOptions = {
  /** Which toolset method backs this MCP tool. */
  method: ToolsetMethodRef;
  /** Telemetry grouping, unchanged from the hand-written tools. */
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
   * Telemetry computed from the finished result. Most methods report from their handler via
   * `ctx.telemetry`; the docs events also carry a token estimate of the rendered text, which only
   * exists here in the adapter.
   */
  resultTelemetry?: (result: { input: unknown; data: unknown; text: string }) => {
    event: string;
    payload: Record<string, unknown>;
  };
  /**
   * Marks the result as an MCP error from the returned data. Some contracts (the docs tools'
   * not-found responses) report failure without throwing, so the flag cannot come from a catch.
   */
  resultIsError?: (data: unknown) => boolean;
};

function resolveMethod(method: ToolsetMethodRef): ToolsetMethod<any, any> {
  const [toolsetId, methodName] = method.split('.');
  return getToolset(toolsetId).methods[methodName];
}

/**
 * Narrows handler output to the published output contract.
 *
 * Handlers may return more than the contract declares so `format` has what it needs; only the
 * declared shape reaches `structuredContent`.
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
    throw new Error(
      `Toolset output did not match its published output schema: ${JSON.stringify(result.issues)}`
    );
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

/** Runs one toolset method and shapes it into an MCP tool result. */
export async function callToolsetMethod(
  server: Server,
  options: ToolsetToolOptions,
  input: unknown
): Promise<StorybookAiToolCallResult> {
  const method = resolveMethod(options.method);
  const ctx = buildContext(server, options);

  try {
    const data = await method.handler(input as never, ctx);
    const structuredContent = await toStructuredContent(method.outputSchema, data);
    const formatted = method.format(data as never, ctx);
    const blocks = Array.isArray(formatted) ? formatted : [formatted];

    if (options.resultTelemetry && !server.ctx.custom?.disableTelemetry) {
      const { event, payload } = options.resultTelemetry({
        input,
        data,
        text: blocks.join('\n'),
      });
      await collectTelemetry({ event, server, toolset: options.telemetryToolset, ...payload });
    }

    return {
      content: blocks.map((text) => ({ type: 'text' as const, text })),
      ...(structuredContent ? { structuredContent } : {}),
      ...(options.resultIsError?.(data) ? { isError: true } : {}),
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
  const method = resolveMethod(options.method);
  const descriptionCtx: ToolsetCtx = {
    consumer: 'mcp',
    getService: (serviceId, serviceOptions) => getService(serviceId as any, serviceOptions) as any,
  };

  return {
    name: MCP_TOOL_NAMES[options.method],
    title: MCP_TOOL_TITLES[options.method],
    description: resolveToolsetDescription(method.description, descriptionCtx),
    schema: options.wrapSchema ? options.wrapSchema(method.schema) : method.schema,
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
