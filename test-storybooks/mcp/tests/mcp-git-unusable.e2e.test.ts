import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { x } from 'tinyexec';
import {
	createMCPRequestBody,
	parseMCPResponse,
	waitForMcpEndpoint,
	killPort,
	startStorybook,
	stopStorybook,
} from './helpers';

/**
 * The git-unusable scenario (not a git repository, or git itself broken) with `changeDetection`
 * on: change detection legitimately answers "no changes detected", exactly as it did before the
 * toolset swap — the tool must stay in the agent's repertoire instead of erroring.
 */

const PORT = 6011;
const MCP_ENDPOINT = `http://localhost:${PORT}/mcp`;
const STARTUP_TIMEOUT = 60_000;

let storybookProcess: ReturnType<typeof x> | null = null;

async function mcpRequest(method: string, params: any = {}, id: number = 1) {
	const response = await fetch(MCP_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(createMCPRequestBody(method, params, id)),
	});

	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}

	return parseMCPResponse(response);
}

describe('MCP endpoint when git is unusable', () => {
	beforeAll(async () => {
		await killPort(PORT);
		// GIT_DIR pointing nowhere makes every git invocation fail, without touching the repo.
		storybookProcess = startStorybook('.storybook', PORT, { GIT_DIR: '/nonexistent' });
		await waitForMcpEndpoint(MCP_ENDPOINT);
	}, STARTUP_TIMEOUT);

	afterAll(async () => {
		await stopStorybook(storybookProcess);
		storybookProcess = null;
	});

	it('answers get-changed-stories with the no-changes sentence instead of an error', async () => {
		const response = await mcpRequest('tools/call', {
			name: 'get-changed-stories',
			arguments: {},
		});

		expect(response.result.isError).toBeUndefined();
		expect(response.result.content[0].text).toBe(
			'No new, modified, or related stories detected.',
		);
	});
});
