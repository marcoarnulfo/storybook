import * as v from 'valibot';
import { describe, expectTypeOf, it } from 'vitest';

import { defineToolset, type ToolsetCtx, type ToolsetDefinition } from './index.ts';

const exampleToolset = defineToolset({
  id: 'example',
  description: 'Example API',
  methods: {
    greet: {
      description: 'Greets a person.',
      schema: v.object({ name: v.string() }),
      handler: async ({ name }) => ({ greeting: `Hello ${name}` }),
      format: (data) => data.greeting,
    },
  },
});

const reviewToolset = defineToolset({
  id: 'review',
  description: 'Create a review',
  methods: {
    create: {
      description: (ctx) => `Create a review (${ctx.consumer})`,
      schema: v.object({ title: v.string() }),
      outputSchema: v.object({ title: v.string() }),
      handler: async (input, ctx): Promise<{ title: string; origin?: string }> => ({
        title: input.title,
        origin: ctx.origin,
      }),
      format: (data) => data.title,
    },
  },
});

describe('defineToolset types', () => {
  // Assertions live outside the definition literal: inside it, the first contextual-typing pass
  // sees `any`/`unknown` params, so exact-type checks there would report on the wrong pass.
  it('types handler input from the method schema', () => {
    const greet: (input: { name: string }, context: ToolsetCtx) => Promise<{ greeting: string }> =
      exampleToolset.methods.greet.handler;
    const create: (
      input: { title: string },
      context: ToolsetCtx
    ) => Promise<{ title: string; origin?: string }> = reviewToolset.methods.create.handler;

    expectTypeOf(greet).toBeFunction();
    expectTypeOf(create).toBeFunction();
    expectTypeOf(exampleToolset).toMatchTypeOf<ToolsetDefinition>();
  });

  it('types format input from the handler return type', () => {
    const greetFormat: (data: { greeting: string }, context: ToolsetCtx) => string =
      exampleToolset.methods.greet.format;
    const createFormat: (data: { title: string; origin?: string }, context: ToolsetCtx) => string =
      reviewToolset.methods.create.format;

    expectTypeOf(greetFormat).toBeFunction();
    expectTypeOf(createFormat).toBeFunction();
  });

  it('resolves description functions against the toolset context', () => {
    const description: string | ((context: ToolsetCtx) => string) =
      reviewToolset.methods.create.description;

    expectTypeOf(description).not.toBeNever();
  });
});
