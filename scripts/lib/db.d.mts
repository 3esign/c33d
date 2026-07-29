// Ambient types for the session store (scripts/lib/db.mjs), which is plain ESM
// so it can be imported both by the Vite config (Node) and by the CLI scripts.
export function openDb(root?: string): any;
export function dbFile(): string | null;
export function currentVersionTag(): string | null;
export function addVersion(v: { tag: string; gitSha?: string | null; note?: string | null }): string | null;
export function upsertSession(s: Record<string, any>): string;
export function addTurn(t: Record<string, any>): number;
export function addMessage(m: Record<string, any>): void;
export function addRun(r: Record<string, any>): void;
export function addComment(c: { sessionId?: string | null; turnId?: number | null; body: string; tag?: string | null }): void;
export function latestSessionId(): string | null;
export function stats(): Record<string, any>;
