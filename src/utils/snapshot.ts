// Viewport snapshot registry. The Canvas (with preserveDrawingBuffer) registers
// itself here; anyone can capture a downscaled PNG data URL.

let viewportCanvas: HTMLCanvasElement | null = null;

export function registerViewportCanvas(canvas: HTMLCanvasElement | null) {
  viewportCanvas = canvas;
}

export function captureViewportSnapshot(maxSize = 512): string | null {
  if (!viewportCanvas) return null;
  try {
    const srcW = viewportCanvas.width;
    const srcH = viewportCanvas.height;
    if (srcW === 0 || srcH === 0) return null;
    const scale = Math.min(1, maxSize / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const ctx = off.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(viewportCanvas, 0, 0, w, h);
    return off.toDataURL('image/png');
  } catch (e) {
    console.warn('Snapshot capture failed:', e);
    return null;
  }
}
