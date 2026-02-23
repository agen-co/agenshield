/**
 * Setup API utilities
 *
 * The old wizard API functions have been removed — the daemon always starts
 * in full mode and the UI determines flow based on DB state.
 *
 * Shield progress SSE events are handled by the main useSSE hook
 * (hooks/useSSE.ts) — no separate EventSource is needed.
 */
