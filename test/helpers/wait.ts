/**
 * Waits for tests that read no API: what the page or the core does in-process. A contract test
 * polls the API with `until` from `contract-fixture.ts`, which paces its reads to the API's rate
 * limit.
 */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls `check` every 25ms until it holds, on real time. */
export async function until(check: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await check()) return;
        await sleep(25);
    }
    throw new Error(`condition not met within ${timeoutMs}ms`);
}
