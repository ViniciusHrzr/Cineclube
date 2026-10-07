import { useEffect, useRef } from 'react';
import { clubPath, hasClub } from '@/lib/api';
import { streamUrl } from '@/lib/session';

export type LiveKind =
  | 'social'
  | 'reviews'
  | 'watchlist'
  | 'reviewers'
  | 'screening'
  | 'club'
  | 'shows';

const KINDS: readonly string[] = [
  'social',
  'reviews',
  'watchlist',
  'reviewers',
  'screening',
  'club',
  'shows',
];

type Frame = { kind: LiveKind | 'hello'; by: string | null; at: number };

const COALESCE_MS = 200;

const MAX_FAILURES = 6;

const listeners = new Set<(kind: LiveKind) => void>();
let source: EventSource | null = null;
let failures = 0;
let retry = 0;
let opening = false;

async function open() {
  if (source || opening) return;
  if (!hasClub()) return;

  opening = true;
  let endereco: string;
  try {
    endereco = await streamUrl(clubPath('/live/stream'));
  } finally {
    opening = false;
  }
  if (source || !hasClub()) return;

  const es = new EventSource(endereco, { withCredentials: true });
  source = es;

  es.onopen = () => {
    failures = 0;
  };

  es.onmessage = e => {
    let frame: Frame;
    try {
      frame = JSON.parse(e.data);
    } catch {
      return;
    }
    if (!KINDS.includes(frame.kind)) return;
    listeners.forEach(fn => fn(frame.kind as LiveKind));
  };

  es.onerror = () => {
    if (source !== es) return;
    es.close();
    source = null;
    failures += 1;
    if (failures >= MAX_FAILURES) return;
    retry = window.setTimeout(() => {
      retry = 0;
      if (listeners.size) void open();
    }, 1000 * failures);
  };
}

function close() {
  if (retry) {
    window.clearTimeout(retry);
    retry = 0;
  }
  source?.close();
  source = null;
}

export function resetLive() {
  close();
  failures = 0;
  if (listeners.size) void open();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!listeners.size || source) return;
    failures = 0;
    void open();
  });
}

export function useLive(
  handler: (kinds: ReadonlySet<LiveKind>) => void,
  enabled = true
) {
  const held = useRef(handler);
  held.current = handler;

  useEffect(() => {
    if (!enabled) return;

    let timer = 0;
    const pending = new Set<LiveKind>();

    const fn = (kind: LiveKind) => {
      pending.add(kind);
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        const batch = new Set(pending);
        pending.clear();
        held.current(batch);
      }, COALESCE_MS);
    };

    listeners.add(fn);
    if (!source) void open();

    return () => {
      listeners.delete(fn);
      if (timer) window.clearTimeout(timer);
      if (!listeners.size) close();
    };
  }, [enabled]);
}
