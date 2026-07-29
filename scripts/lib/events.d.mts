export function eventsDir(root?: string): string;
export function appendEvent(root: string, port: number | string | null, event: Record<string, any>): Record<string, any>;
export function eventFiles(root?: string): string[];
export function readAllEvents(root?: string): { events: Record<string, any>[]; problems: string[] };
