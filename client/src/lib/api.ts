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
  /* Os outros nomes do filme, para a busca do acervo. Lidos do cache do filme
     e não gravados com a avaliação — ver `crowd` abaixo, que vem de lá pelo
     mesmo motivo. */
  movieOriginal?: string | null;
  movieEnglish?: string | null;
  moviePoster: string | null;
  movieDirector: string | null;
  /** How long the film runs, in minutes. Null when TMDB never reported one. */
  movieRuntime: number | null;
  scores: Record<string, number>;
  final: number;
  date: string;
  comment: string;
  breakdown: BreakdownRow[];
  /* What TMDB's own voters gave the film, on the same 0–10 as `final`. Read
     from the film cache rather than stored with the take: it is a fact about
     the film and it keeps moving, while the take is frozen. Null on a film the
     cache has never seen. */
  crowd?: { score: number; votes: number } | null;
};

export type Movie = {
  id: number;
  title: string;
  /* O nome com que o filme circula lá fora, para quem vai atrás de uma cópia:
     "Entre Facas e Segredos" não acha nada, "Knives Out" acha. Null when it is
     the same string as `title`, which is most films — the line is only drawn
     when it has something to add. Not always English: it is TMDB's original
     title, so a Korean film comes back in Korean. */
  original?: string | null;
  /* O nome em inglês, quando ele não é nenhum dos dois acima — Parasita é
     `Parasita`, `기생충` e `Parasite`, e só o terceiro acha uma cópia. Existe
     para as buscas locais e não é desenhado em lugar nenhum. Só chega em filme
     que o clube guardou: ficha aberta, fila ou avaliado. */
  english?: string | null;
  year: number | null;
  /** The genre it opens on: the first of `genres`. */
  genre: string;
  /** Every genre in the club's taxonomy this film carries, most specific first. */
  genres?: string[];
  poster: string | null;
  director?: string | null;
  /** Minutes. Only the details endpoint carries it; a search result has none. */
  runtime?: number | null;
  overview?: string | null;
  cast?: { name: string }[];
  /* Who signs each criterion, keyed by criterion key — `fotografia`, `som`,
     `montagem`. Built by the server from credits it was already parsing. A key
     is absent when nobody is credited for it, which happens honestly: an
     animation rarely credits a director of photography, and nobody at all
     signs `originalidade`. */
  crew?: Record<string, string[]>;
  /* TMDB's own average, on the same 0–10 as the club's, with the number of
     people behind it. Null when nobody has voted — TMDB reports that as an
     average of zero, which is not the same thing as a bad film. */
  crowd?: { score: number; votes: number } | null;
  trailerUrl?: string | null;
  /* Where the film can be watched in Brazil, from TMDB's JustWatch data. Null
     when nothing carries it here, which for an old or obscure film is the
     common case — and absent entirely on a cached film, because the cache does
     not store it: a catalogue moves and a stale answer to "está na Netflix?"
     is worse than no answer. */
  watch?: {
    /** TMDB's page for this film's providers. The link out, as they ask. */
    link: string | null;
    /* Included in something already paid for: flatrate, free and ad-supported
       alike. Rental and purchase are not carried — see `watchIn` in tmdb.js. */
    streaming: Provider[];
  } | null;
  stale?: boolean;
};

export type Provider = { id: number; name: string; logo: string | null };

export type WatchItem = {
  id: number;
  title: string;
  /** See `Movie['original']`. Read through the film cache, not stored here. */
  original?: string | null;
  /** See `Movie['english']`. Also read through the cache. */
  english?: string | null;
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

/* ── how long it runs ─────────────────────────────────────────────────────
   Written the way a listing writes it — 1h 52min, 2h for a round one, 48min
   for a short — rather than the raw minute count TMDB reports, because "112"
   is a number to convert and "1h 52min" is a length of evening. Null when the
   film has no runtime on record, so every caller can decide with `? :` whether
   the line has a duration in it at all. */
export function runtimeOf(minutes: number | null | undefined) {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h ${m}min` : `${h}h`;
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
