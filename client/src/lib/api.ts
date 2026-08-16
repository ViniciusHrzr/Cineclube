/* The Express API is unchanged: this file is the only place that knows its
   shapes, so the screens stay about the interface. Every field here mirrors a
   DTO the server already returns. */

export type Reviewer = {
  id: string;
  name: string;
  dot: string;
  isAdmin?: boolean;
  /** false means the account exists but nobody has set a PIN for it yet. */
  hasPin?: boolean;
  /** URL of the portrait, versioned so it can be cached forever. Null: none. */
  avatar?: string | null;
  review_count?: number;
};

export type SessionUser = {
  id: string;
  name: string;
  dot: string;
  isAdmin: boolean;
  avatar?: string | null;
};

export const auth = {
  me: () => api<{ reviewer: SessionUser | null }>('/api/auth/me'),
  login: (reviewerId: string, pin: string) =>
    post<{ reviewer: SessionUser }>('/api/auth/login', { reviewerId, pin }),
  logout: () => post<null>('/api/auth/logout', {}),
  changePin: (currentPin: string, newPin: string) =>
    post<{ ok: true }>('/api/auth/pin', { currentPin, newPin }),
  resetPin: (reviewerId: string, newPin: string) =>
    post<{ ok: true }>('/api/auth/pin/reset', { reviewerId, newPin }),
};

/* Your own name and your own portrait. The route takes no id — it edits
   whoever the session says you are, which is why there is no way to ask it to
   edit somebody else. */
export const profile = {
  update: (patch: { name?: string; avatar?: string | null }) =>
    api<{ reviewer: SessionUser }>('/api/reviewers/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
};

export type Criterion = { key: string; name: string; hint: string; w: number };

export type BreakdownRow = { key: string; name: string; w: number; value: number };

export type Review = {
  id: string;
  reviewerId: string;
  reviewerName: string;
  reviewerDot: string;
  movieId: number;
  movieTitle: string;
  movieYear: number | null;
  movieGenre: string;
  moviePoster: string | null;
  movieDirector: string | null;
  scores: Record<string, number>;
  final: number;
  date: string;
  comment: string;
  breakdown: BreakdownRow[];
};

export type Movie = {
  id: number;
  title: string;
  year: number | null;
  genre: string;
  poster: string | null;
  director?: string | null;
  overview?: string | null;
  cast?: { name: string }[];
  trailerUrl?: string | null;
  stale?: boolean;
};

export type WatchItem = {
  id: number;
  title: string;
  year: number | null;
  genre: string;
  poster: string | null;
  addedAt?: string;
};

export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* the server did not send a JSON body; the status text stands */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}

export const post = <T>(path: string, body: unknown) =>
  api<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const del = (path: string) => api<null>(path, { method: 'DELETE' });

/* ── product truth, mirrored for immediate feedback ──────────────────────
   The server owns the formula (app/criteria.js). The client recomputes it only
   so the score answers the hand without a round trip; it never decides it. */

export function finalOf(criteria: Criterion[], scores: Record<string, number>) {
  return criteria.reduce((sum, c) => sum + (scores[c.key] ?? 0) * c.w, 0) / 12;
}

export function weightedSum(criteria: Criterion[], scores: Record<string, number>) {
  return criteria.reduce((sum, c) => sum + (scores[c.key] ?? 0) * c.w, 0);
}

export function fmt(n: number) {
  return Number(n).toFixed(1).replace('.', ',');
}

export function verdictFor(final: number) {
  if (final >= 9) return 'Obra excepcional do gênero.';
  if (final >= 8) return 'Muito acima da média.';
  if (final >= 6.5) return 'Bom filme, com ressalvas.';
  if (final >= 5) return 'Irregular — funciona pela metade.';
  return 'Não se sustenta.';
}

export function initialsOf(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '?') + (p[1]?.[0] ?? '')).toUpperCase();
}

/* Reviewer identity: the colour comes from the persisted `dot` the server
   assigns once per person, never from roster position, so removing a member
   cannot recolour everyone else's history. */
const LEGACY_DOTS = ['#b5abfc', '#cfd3e5', '#a7a1db', '#b2b6ca', '#d2cefd', '#9397ab'];
const REEL = [
  '#e0362c', '#43b8c6', '#e8b44a', '#7bc47f', '#c77dd6',
  '#f08a5d', '#5b8dd9', '#d95f8a', '#8fce7c', '#c9bfae',
];
function hashOf(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
export function reelColor(dot: string | null | undefined, id: string) {
  const i = LEGACY_DOTS.indexOf(String(dot ?? '').toLowerCase());
  return i >= 0 ? REEL[i] : REEL[hashOf(id) % REEL.length];
}
