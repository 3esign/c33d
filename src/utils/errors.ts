export function isSystemError(errorStr: string | null | undefined): boolean {
  if (!errorStr) return false;
  const lower = errorStr.toLowerCase();
  // Raw WASM exception codes: Emscripten throws bare numbers (e.g. "24").
  if (/^\d+$/.test(lower.trim())) return true;
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
         lower.includes('worker error') ||
         lower.includes('kernel exception') ||
         lower.includes('is not a constructor') ||
         lower.includes('kernel canary');
}
