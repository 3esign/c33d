// ---------------------------------------------------------------------------
// SessionNote — leave your verdict and a note without leaving the app.
//
// The app records what happened automatically; this records what YOU thought
// of it, which no amount of telemetry can infer. It writes to the same store
// (/api/store/comment) that the launcher's note option writes to.
//
// Two rules it must never break:
//   1. Nothing typed here is ever sent to a model or added to the transcript.
//      It is your private margin note on the run.
//   2. It must never block. If the store is missing (production build, no dev
//      server) the button still works and simply reports that it wasn't saved.
//
// Collapsed it is a single small pill; Ctrl+Enter saves, Escape closes.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import { saveSessionNote } from '../store/useStore';

type Verdict = 'OK' | 'WEAK' | 'FAIL';

const VERDICT_STYLE: Record<Verdict, { on: string; off: string; hint: string }> = {
  OK: {
    on: 'bg-emerald-600 text-white border-emerald-500',
    off: 'border-slate-700 text-emerald-400/80 hover:border-emerald-600/60 hover:bg-emerald-950/40',
    hint: 'did what I asked',
  },
  WEAK: {
    on: 'bg-amber-600 text-white border-amber-500',
    off: 'border-slate-700 text-amber-400/80 hover:border-amber-600/60 hover:bg-amber-950/40',
    hint: 'partly there',
  },
  FAIL: {
    on: 'bg-rose-600 text-white border-rose-500',
    off: 'border-slate-700 text-rose-400/80 hover:border-rose-600/60 hover:bg-rose-950/40',
    hint: 'no usable result',
  },
};

export function SessionNote() {
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [body, setBody] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Ctrl+M from anywhere opens the note — the point is that it costs nothing
  // to record a thought the moment you have it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) areaRef.current?.focus();
  }, [open]);

  const save = async () => {
    if (!verdict && !body.trim()) { setOpen(false); return; }
    const saved = await saveSessionNote(body.trim(), verdict);
    setFlash(saved ? (verdict ? `Saved — ${verdict}` : 'Saved') : 'Not saved (no store running)');
    setBody('');
    setVerdict(null);
    setOpen(false);
    setTimeout(() => setFlash(null), 2600);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Leave a note on this session (Ctrl+M) — stored with the data, never sent to a model"
        className="absolute top-3 right-3 z-30 flex items-center gap-1.5 rounded-full border border-slate-700/80
                   bg-slate-900/85 px-3 py-1.5 text-xs text-slate-300 backdrop-blur
                   transition-colors hover:border-slate-500 hover:text-white"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {flash ?? 'Note'}
      </button>
    );
  }

  return (
    <div
      className="absolute top-3 right-3 z-30 w-80 rounded-lg border border-slate-700 bg-slate-900/95
                 p-3 shadow-2xl backdrop-blur"
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); }
      }}
    >
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-slate-300">How did this run go?</span>
        <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-200" title="Close (Esc)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="mb-2 grid grid-cols-3 gap-1.5">
        {(Object.keys(VERDICT_STYLE) as Verdict[]).map(v => (
          <button
            key={v}
            onClick={() => setVerdict(verdict === v ? null : v)}
            title={VERDICT_STYLE[v].hint}
            className={`rounded border px-2 py-1.5 text-xs font-medium transition-colors ${
              verdict === v ? VERDICT_STYLE[v].on : VERDICT_STYLE[v].off
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      <textarea
        ref={areaRef}
        value={body}
        onChange={e => setBody(e.target.value)}
        rows={3}
        placeholder="What you noticed — &quot;edges were nonsense&quot;, &quot;same failure as the temple&quot;…"
        className="w-full resize-none rounded border border-slate-700 bg-slate-950/80 p-2 text-xs
                   text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none"
      />

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] leading-tight text-slate-500">
          Stored with the data.<br />Never sent to a model.
        </span>
        <button
          onClick={() => void save()}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white
                     transition-colors hover:bg-blue-500"
        >
          Save <span className="text-blue-200/70">Ctrl+↵</span>
        </button>
      </div>
    </div>
  );
}
