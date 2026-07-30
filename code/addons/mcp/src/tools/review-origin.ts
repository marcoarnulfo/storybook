import { DEFAULT_MCP_ENDPOINT } from '../constants.ts';

/**
 * Derives the Storybook root from the MCP request path.
 *
 * A Storybook served under a sub-path answers MCP at `<root><endpoint>`, so the review link has to
 * be built from the request's own path rather than the bare origin.
 */
function storybookRootFromRequest(
  request: Request | undefined,
  trustedOrigin: string,
  endpoint: string
): string | undefined {
  if (!request?.url) {
    return undefined;
  }
  try {
    const url = new URL(request.url);
    const normalizedEndpoint = endpoint.replace(/\/$/, '');
    const normalizedPathname = url.pathname.replace(/\/$/, '');
    const rootPath = normalizedPathname.endsWith(normalizedEndpoint)
      ? normalizedPathname.slice(0, -normalizedEndpoint.length)
      : normalizedPathname.replace(/\/[^/]+$/, '');
    return `${trustedOrigin.replace(/\/$/, '')}${rootPath}`;
  } catch {
    return undefined;
  }
}

/** Origin the review toolset should build its page URL from. */
export function resolveReviewOrigin(context: {
  origin?: string;
  request?: Request;
  endpoint?: string;
}): string | undefined {
  if (!context.origin) {
    return undefined;
  }
  return context.request
    ? (storybookRootFromRequest(
        context.request,
        context.origin,
        context.endpoint ?? DEFAULT_MCP_ENDPOINT
      ) ?? context.origin)
    : context.origin;
}
