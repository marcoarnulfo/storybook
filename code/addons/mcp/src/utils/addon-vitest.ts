/**
 * Probes whether `@storybook/addon-vitest` is installed.
 *
 * Its constants module is the cheapest thing to import that only resolves when the addon is
 * present, so a failed import is the signal that story tests are unavailable here.
 */
export async function getAddonVitestConstants() {
  try {
    const mod = await import('@storybook/addon-vitest/constants');
    return {
      TRIGGER_TEST_RUN_REQUEST: mod.TRIGGER_TEST_RUN_REQUEST,
      TRIGGER_TEST_RUN_RESPONSE: mod.TRIGGER_TEST_RUN_RESPONSE,
    };
  } catch {
    return undefined;
  }
}
