/**
 * Deterministic session title derived from the first prompt.
 * Shared by the gateway (HTTP session creation with an initial prompt)
 * and the realtime server (implicit creation on CALL_TO_AGENT) so both
 * paths produce identical titles.
 */
export function deriveSessionTitle(prompt: string): string {
    return prompt.length > 30 ? prompt.slice(0, 30) + "..." : prompt;
}
