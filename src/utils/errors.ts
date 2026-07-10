export function isSystemError(errorStr: string | null | undefined): boolean {
  if (!errorStr) return false;
  const lower = errorStr.toLowerCase();
  return lower.includes('deleted') ||
         lower.includes('wasm') ||
         lower.includes('out of memory') ||
         lower.includes('memory access') ||
         lower.includes('abort') ||
         lower.includes('unreachable') ||
         lower.includes('signature mismatch') ||
         lower.includes('array bounds') ||
         lower.includes('timed out') ||
         lower.includes('timeout') ||
         lower.includes('opencascade kernel failed') ||
         lower.includes('worker error');
}
