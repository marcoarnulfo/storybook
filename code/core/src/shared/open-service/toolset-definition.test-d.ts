import * as v from 'valibot';
import { describe, expectTypeOf, it } from 'vitest';

import {
  defineToolset,
  type ToolsetCtx,
  type ToolsetDefinition,
  type ToolsetOutcome,
} from './index.ts';

const exampleToolset = defineToolset({
  id: 'example',
  description: 'Example API',
  telemetryGroup: 'dev',
  methods: {
    greet: {
      description: 'Greets a person.',
      schema: v.object({ name: v.string() }),
      handler: async ({ name }): Promise<ToolsetOutcome<{ greeting: string }, never>> => ({
        ok: true,
        data: { greeting: `Hello ${name}` },
        markdown: `Hello ${name}`,
      }),
    },
  },
});

const reviewToolset = defineToolset({
  id: 'review',
  description: 'Create a review',
  telemetryGroup: 'dev',
  methods: {
    create: {
      description: (ctx) => `Create a review (${ctx.consumer})`,
      schema: v.object({ title: v.string() }),
      outputSchema: v.object({ title: v.string() }),
      handler: async (
        input,
        ctx
      ): Promise<ToolsetOutcome<{ title: string; origin?: string }, { reason: string }>> =>
        input.title
          ? { ok: true, data: { title: input.title, origin: ctx.origin }, markdown: input.title }
          : { ok: false, data: { reason: 'missing title' }, markdown: 'missing title' },
    },
  },
});

describe('defineToolset types', () => {
  // Assertions live outside the definition literal: inside it, the first contextual-typing pass
  // sees `any`/`unknown` params, so exact-type checks there would report on the wrong pass.
  it('types handler input from the method schema', () => {
    const greet: (
      input: { name: string },
      context: ToolsetCtx
    ) => Promise<ToolsetOutcome<{ greeting: string }, never>> =
      exampleToolset.methods.greet.handler;
    const create: (
      input: { title: string },
      context: ToolsetCtx
    ) => Promise<ToolsetOutcome<{ title: string; origin?: string }, { reason: string }>> =
      reviewToolset.methods.create.handler;

    expectTypeOf(greet).toBeFunction();
    expectTypeOf(create).toBeFunction();
    expectTypeOf(exampleToolset).toMatchTypeOf<ToolsetDefinition>();
  });

  it('narrows both branches of an outcome on its tag', async () => {
    const outcome = await reviewToolset.methods.create.handler(
      { title: 'x' },
      { consumer: 'cli', getService: () => ({}) as never }
    );

    if (outcome.ok) {
      expectTypeOf(outcome.data).toEqualTypeOf<{ title: string; origin?: string }>();
    } else {
      expectTypeOf(outcome.data).toEqualTypeOf<{ reason: string }>();
    }
  });

  it('makes the failure branch unreachable for infallible methods', async () => {
    const outcome = await exampleToolset.methods.greet.handler({ name: 'x' });

    if (!outcome.ok) {
      expectTypeOf(outcome.data).toBeNever();
    }
  });

  it('resolves description functions against the toolset context', () => {
    const description: string | ((context: ToolsetCtx) => string) =
      reviewToolset.methods.create.description;

    expectTypeOf(description).not.toBeNever();
  });
});
