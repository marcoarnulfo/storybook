import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { GetServiceOptions } from './types.ts';

type AnySchema = StandardSchemaV1<unknown, unknown>;

export type ToolsetConsumer = 'cli' | 'mcp';

/**
 * Service lookup for toolset handlers. Intentionally not keyed to ServerCoreServices:
 * toolsets may call core OSA (with `{ internal: true }`) or optional addon services by id.
 */
export type ToolsetGetService = {
  <TInstance = unknown>(serviceId: string, options?: GetServiceOptions): TInstance;
};

/**
 * Emits one telemetry event for a toolset method.
 *
 * Adapters supply the sink so surface-specific fields (MCP session id, client info) stay with the
 * adapter while the event name and payload — the part that describes the capability — stay in the
 * method. Absent when the consumer has telemetry disabled.
 */
export type ToolsetTelemetry = (event: string, payload: Record<string, unknown>) => Promise<void>;

export type ToolsetCtx = {
  consumer: ToolsetConsumer;
  /** Storybook server origin. Absent when running from a CLI without a live Storybook. */
  origin?: string;
  getService: ToolsetGetService;
  telemetry?: ToolsetTelemetry;
};

/**
 * A method description, resolved per consumer.
 *
 * The function form exists because descriptions cross-reference sibling methods, and each surface
 * spells those differently (`get-changed-stories` on MCP, `npx storybook tools stories changed` on
 * the CLI). Use `getRef(ctx)` to render a reference rather than hardcoding either spelling.
 */
export type ToolsetMethodDescription = string | ((context: ToolsetCtx) => string);

/**
 * One public method.
 *
 * `handler` produces data and owns side effects and telemetry; `format` renders that data as the
 * text a consumer shows. They are separate because one MCP response carries both at once —
 * `content` (text) and `structuredContent` (JSON) — and a single method run must produce both.
 */
export type ToolsetMethod<TSchema extends AnySchema = AnySchema, TOutput = unknown> = {
  description: ToolsetMethodDescription;
  schema: TSchema;
  /** Published as the MCP tool's `outputSchema`. Declare it only where the JSON is contractual. */
  outputSchema?: AnySchema;
  handler: (input: StandardSchemaV1.InferOutput<TSchema>, context: ToolsetCtx) => TOutput;
  format: (data: Awaited<TOutput>, context: ToolsetCtx) => string;
};

// `any` permits a heterogeneous method map. Each individual method remains typed by `defineToolset`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolsetMethods = Record<string, ToolsetMethod<any, any>>;

export type ToolsetDefinition<
  TId extends string = string,
  TMethods extends ToolsetMethods = ToolsetMethods,
> = {
  id: TId;
  description: string;
  methods: TMethods;
};

export type AnyToolsetDefinition = ToolsetDefinition;

/**
 * Second contextual-typing pass for the methods literal: `handler` input comes from that method's
 * own `schema`, and `format` data from that method's own `handler` return. Intersecting this with
 * the inferred map is what makes the flow work on both the stable and the native TypeScript
 * compiler — inferring a separate outputs record does not.
 */
type MethodContracts<TMethods extends ToolsetMethods> = {
  [TKey in keyof TMethods]: {
    handler: (
      input: StandardSchemaV1.InferOutput<TMethods[TKey]['schema']>,
      context: ToolsetCtx
    ) => unknown;
    format: (data: Awaited<ReturnType<TMethods[TKey]['handler']>>, context: ToolsetCtx) => string;
  };
};

export function defineToolset<const TId extends string, const TMethods extends ToolsetMethods>(
  definition: {
    id: TId;
    description: string;
    methods: TMethods & MethodContracts<TMethods>;
  }
): ToolsetDefinition<TId, TMethods> {
  return definition;
}

/** Resolves a method description for one consumer. */
export function resolveToolsetDescription(
  description: ToolsetMethodDescription,
  context: ToolsetCtx
): string {
  return typeof description === 'function' ? description(context) : description;
}
