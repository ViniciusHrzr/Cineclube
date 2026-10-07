import { inShell } from '@/lib/shell';
import {
  appMode,
  authHeaders,
  credentialsMode,
  hasPair,
  refreshSession,
  refreshToken,
  setPair,
  urlFor,
} from '@/lib/session';

export type Reviewer = {
  id: string;
  name: string;
  dot: string;
  handle?: string | null;
  isAdmin?: boolean;
  role?: 'admin' | 'member' | null;
  hasPassword?: boolean;
  joinedAt?: string | null;
  bio?: string | null;
  createdAt?: string | null;
  avatar?: string | null;
  review_count?: number;
};

export type SessionUser = {
  id: string;
  name: string;
  dot: string;
  isAdmin: boolean;
  email?: string | null;
  emailVerified?: boolean;
  avatar?: string | null;
  bio?: string | null;
};

export type Club = {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  visibility: 'public' | 'private';
  showReviews?: boolean;
  showComments?: boolean;
  photo: string | null;
  createdAt?: string | null;
  role?: 'admin' | 'member' | null;
  isMember?: boolean;
  isCreator?: boolean;
  members?: number;
  requested?: boolean;
  pending?: number;
};

export type ClubMember = {
  id: string;
  name: string;
  dot: string;
  role: 'admin' | 'member';
  avatar: string | null;
  joinedAt?: string;
};

export type JoinRequest = {
  id: string;
  name: string;
  dot: string;
  avatar: string | null;
  createdAt: string;
};

export const auth = {
  me: () =>
    api<{
      reviewer: SessionUser | null;
      needsPassword?: boolean;
      google?: boolean;
      mail?: boolean;
    }>('/api/auth/me'),
  googleUrl: urlFor('/api/auth/google') + (inShell() ? '?app=1' : ''),
  handoff: async (code: string) => {
    const got = await post<{ access: string; refresh: string; reviewer: SessionUser }>(
      '/api/auth/token',
      { handoff: code }
    );
    setPair({ access: got.access, refresh: got.refresh });
    return got.reviewer;
  },
  login: async (email: string, password: string) => {
    if (!appMode) return post<{ reviewer: SessionUser }>('/api/auth/login', { email, password });
    const got = await post<{ access: string; refresh: string; reviewer: SessionUser }>(
      '/api/auth/token',
      { email, password }
    );
    setPair({ access: got.access, refresh: got.refresh });
    return { reviewer: got.reviewer };
  },
  adopt: async () => {
    if (!appMode || hasPair()) return false;
    try {
      const got = await post<{ access: string; refresh: string }>('/api/auth/token', {});
      setPair({ access: got.access, refresh: got.refresh });
      return true;
    } catch {
      return false;
    }
  },
  register: (name: string, email: string, password: string) =>
    post<{ reviewer: SessionUser }>('/api/auth/register', { name, email, password }),
  logout: async () => {
    const refresh = refreshToken();
    setPair(null);
    return post<null>('/api/auth/logout', { refresh });
  },
  setPassword: (password: string, current?: string) =>
    post<{ ok: true }>('/api/auth/password', { password, current: current ?? null }),
  sendVerification: () => post<{ ok: true; sent?: boolean; already?: boolean }>('/api/auth/verify/send', {}),
  verifyEmail: (token: string) => post<{ ok: true; name: string }>('/api/auth/verify', { token }),
  requestReset: (email: string) => post<{ ok: true }>('/api/auth/reset/request', { email }),
  resetPassword: (token: string, password: string) =>
    post<{ reviewer: SessionUser }>('/api/auth/reset', { token, password }),
};

export const clubs = {
  all: () => api<{ mine: Club[]; open: Club[]; founded: boolean }>('/api/clubs'),
  create: (body: { name: string; tagline?: string; visibility: 'public' | 'private'; photo?: string | null }) =>
    post<{ club: Club }>('/api/clubs', body),
  get: (slug: string) => api<{ club: Club }>(`/api/c/${encodeURIComponent(slug)}`),
  update: (
    slug: string,
    patch: Partial<
      Pick<Club, 'name' | 'tagline' | 'visibility' | 'showReviews' | 'showComments'>
    > & {
      photo?: string | null;
    }
  ) =>
    api<{ club: Club }>(`/api/c/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  remove: (slug: string) => del(`/api/c/${encodeURIComponent(slug)}`),
  members: (slug: string) => api<{ members: ClubMember[] }>(`/api/c/${encodeURIComponent(slug)}/members`),
  leave: (slug: string, reviewerId: string) =>
    del(`/api/c/${encodeURIComponent(slug)}/members/${reviewerId}`),
  setRole: (slug: string, reviewerId: string, role: 'admin' | 'member') =>
    api<{ ok: true }>(`/api/c/${encodeURIComponent(slug)}/members/${reviewerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    }),
  join: (slug: string) =>
    post<{ joined?: true; requested?: true }>(`/api/c/${encodeURIComponent(slug)}/join`, {}),
  unjoin: (slug: string) => del(`/api/c/${encodeURIComponent(slug)}/join`),
  requests: (slug: string) => api<{ requests: JoinRequest[] }>(`/api/c/${encodeURIComponent(slug)}/requests`),
  answer: (slug: string, reviewerId: string, approve: boolean) =>
    post<{ ok: true; approved: boolean }>(
      `/api/c/${encodeURIComponent(slug)}/requests/${reviewerId}`,
      { approve }
    ),
};

export type Universe = 'filmes' | 'series';

export type SeriesItem = {
  id: number;
  title: string;
  original: string | null;
  year: number | null;
  genre: string;
  genres: string[];
  poster: string | null;
  crowd: { score: number; votes: number } | null;
  watch?: {
    link: string | null;
    streaming: Provider[];
  } | null;
};

export type SeriesSeason = {
  season: number;
  name: string;
  episodes: number;
  year: number | null;
  poster: string | null;
  overview: string | null;
};

export type ShowDetail = SeriesItem & {
  english: string | null;
  endedYear: number | null;
  status: string | null;
  inProduction: boolean;
  overview: string | null;
  creators: string[];
  runtime: number | null;
  seasons: SeriesSeason[] | null;
  totalEpisodes: number | null;
  orders: { id: string; name: string; episodes: number; groups: number }[];
  trailerUrl: string | null;
  stale?: boolean;
};

export type Episode = {
  season: number;
  episode: number;
  title: string;
  overview: string | null;
  still: string | null;
  airDate: string | null;
  runtime: number | null;
  crowd: { score: number; votes: number } | null;
  kind: string | null;
};

export type EpisodeDetail = Episode & { crew: Record<string, string[]> };

export type SeasonDetail = {
  season: number;
  name: string;
  overview: string | null;
  poster: string | null;
  episodes: Episode[];
};

export const seriesApi = {
  popular: (page = 1) =>
    api<{ page: number; totalPages: number; results: SeriesItem[] }>(
      `/api/series/popular?page=${page}`
    ),
  search: (q: string, page = 1) =>
    api<{ page: number; totalPages: number; results: SeriesItem[] }>(
      `/api/series/search?q=${encodeURIComponent(q)}&page=${page}`
    ),
  byGenre: (genre: string, page = 1) =>
    api<{ page: number; totalPages: number; results: SeriesItem[] }>(
      `/api/series/genre/${encodeURIComponent(genre)}?page=${page}`
    ),
  show: (id: number) => api<{ show: ShowDetail }>(`/api/series/${id}`),
  season: (id: number, season: number) =>
    api<{ season: SeasonDetail }>(`/api/series/${id}/season/${season}`),
  episode: (id: number, season: number, episode: number) =>
    api<{ episode: EpisodeDetail }>(`/api/series/${id}/episode/${season}/${episode}`),
  criteria: () =>
    api<{ genres: string[]; criteria: Record<string, Criterion[]> }>('/api/series/criteria'),
};

export type ReelItem = {
  id: number;
  kind: 'movie' | 'show';
  title: string;
  original: string | null;
  year: number | null;
  genre: string;
  genres: string[];
  poster: string | null;
  backdrop: string | null;
  overview: string | null;
  crowd: { score: number; votes: number } | null;
  trailerKey: string;
};

export const reels = {
  genres: (kind: ReelItem['kind']) =>
    api<{ genres: string[] }>(`/api/reels/genres?kind=${kind}`),
  page: (kind: ReelItem['kind'], genre: string | null, page = 1, like: number[] = []) =>
    api<{ page: number; totalPages: number; results: ReelItem[] }>(
      `/api/reels?kind=${kind}&page=${page}` +
        (genre ? `&genre=${encodeURIComponent(genre)}` : '') +
        (like.length ? `&like=${like.join(',')}` : '')
    ),
  pinned: (kind: ReelItem['kind'], ids: number[]) =>
    api<{ results: ReelItem[] }>(`/api/reels/pinned?kind=${kind}&ids=${ids.join(',')}`),
};

export type QueuedShow = {
  id: number;
  title: string;
  original: string | null;
  english: string | null;
  year: number | null;
  genre: string;
  poster: string | null;
  status: string | null;
  totalEpisodes: number | null;
  addedAt: string;
  wanters: string[];
  seen: number;
  rated: number;
  average: number | null;
  upNext?: EpisodeRef | null;
  upcoming?: EpisodeRef | null;
  caughtUp?: boolean;
  watch?: {
    link: string | null;
    streaming: Provider[];
  } | null;
};

export type EpisodeRef = {
  season: number;
  episode: number;
  title: string | null;
  airDate: string | null;
};

export type ShowTake = {
  id: string;
  kind: 'episode' | 'season';
  showId: number;
  showTitle: string;
  showPoster: string | null;
  genre: string;
  season: number;
  episode: number | null;
  episodeTitle: string | null;
  reviewerId: string;
  reviewerName: string | null;
  reviewerDot: string | null;
  scores: Record<string, number> | null;
  quick: number | null;
  final: number | null;
  comment: string | null;
  watchedAt: string;
  ratedAt: string | null;
  breakdown: BreakdownRow[];
};

export type TakeComment = {
  id: string;
  takeId: string;
  reviewerId: string;
  reviewerName: string;
  reviewerDot: string;
  body: string;
  parentId?: string | null;
  createdAt: string;
};

export type TakeVote = { takeId: string; reviewerId: string; value: 1 | -1 };

export type ShowFeedEvent = {
  id: string;
  kind: 'take' | 'seen' | 'comment';
  at: string;
  actor: { id: string; name: string; dot: string };
  showId: number;
  showTitle: string;
  showPoster: string | null;
  genre?: string;
  season?: number;
  episode?: number | null;
  episodeTitle?: string | null;
  takeId?: string;
  final?: number;
  ends?: { high: { name: string; value: number }; low: { name: string; value: number } } | null;
  excerpt?: string | null;
  commentId?: string;
  parentId?: string | null;
  owner?: { id: string; name: string };
  count?: number;
  from?: { season: number; episode: number };
  to?: { season: number; episode: number; title: string | null };
};

export const showsSocial = {
  all: () =>
    capi<{ comments: TakeComment[]; votes: TakeVote[]; commentLikes: CommentLike[] }>(
      '/shows-social'
    ),
  comment: (takeId: string, body: string, parentId?: string | null) =>
    cpost<TakeComment>(`/shows-social/takes/${takeId}/comments`, { body, parentId: parentId ?? null }),
  uncomment: (id: string) => cdel(`/shows-social/comments/${id}`),
  likeComment: (id: string, liked: boolean) =>
    cput<{ liked: boolean }>(`/shows-social/comments/${id}/like`, { liked }),
  vote: (takeId: string, value: 1 | -1 | 0) =>
    cput<{ vote: TakeVote | null }>(`/shows-social/takes/${takeId}/vote`, { value }),
  feed: () => capi<{ items: ShowFeedEvent[] }>('/shows-feed'),
};

export type MarkPatch = {
  showTitle: string;
  showPoster?: string | null;
  episodeTitle?: string | null;
  genre: string;
};

export type SeasonPatch = {
  showTitle: string;
  showPoster?: string | null;
  genre: string;
  quick?: number;
  scores?: Record<string, number>;
  comment?: string | null;
};

export const shows = {
  queue: () => capi<{ shows: QueuedShow[] }>('/shows'),
  add: (show: { id: number; title: string; year: number | null; genre: string; poster: string | null }) =>
    cpost<{ ok: true }>('/shows', { show }),
  remove: (showId: number) => cdel(`/shows/${showId}`),
  takes: () => capi<{ takes: ShowTake[] }>('/shows/takes'),
  takesFor: (showId: number) => capi<{ takes: ShowTake[] }>(`/shows/${showId}/takes`),
  mark: (showId: number, season: number, episode: number, patch: MarkPatch) =>
    cput<{ take: ShowTake }>(`/shows/${showId}/${season}/${episode}`, patch),
  unmark: (showId: number, season: number, episode: number) =>
    cdel(`/shows/${showId}/${season}/${episode}`),
  rate: (showId: number, season: number, patch: SeasonPatch) =>
    cput<{ take: ShowTake }>(`/shows/${showId}/${season}`, patch),
  unrate: (showId: number, season: number) => cdel(`/shows/${showId}/${season}`),
};

export const profile = {
  update: (patch: { name?: string; avatar?: string | null; bio?: string | null }) =>
    api<{ reviewer: SessionUser }>('/api/reviewers/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
};

export type CriterionGroup = 'oficio' | 'genero' | 'pessoal';

export type Criterion = { key: string; name: string; hint: string; w: number; group: CriterionGroup };

export type BreakdownRow = {
  key: string;
  name: string;
  w: number;
  group?: CriterionGroup;
  value: number;
};

export type ReviewComment = {
  id: string;
  reviewId: string;
  takeId: string;
  reviewerId: string;
  reviewerName: string;
  reviewerDot: string;
  body: string;
  parentId?: string | null;
  createdAt: string;
};

export type ReviewVote = {
  reviewId: string;
  takeId: string;
  reviewerId: string;
  value: 1 | -1;
};

export type CommentLike = { commentId: string; reviewerId: string };

export type Notice = {
  id: string;
  kind: 'comment' | 'reply' | 'mention' | 'vote' | 'like' | 'join' | 'airing';
  at: string;
  actor?: { id: string; name: string; dot: string; avatar?: string | null };
  club?: { name: string; slug: string };
  movieId?: number;
  reviewId?: string;
  commentId?: string | null;
  text: string;
  excerpt?: string;
  value?: number;
  showId?: number;
  showTitle?: string;
  showPoster?: string | null;
  season?: number;
  episode?: number;
};

export type FeedEvent = {
  id: string;
  kind: 'review' | 'comment' | 'vote' | 'queued';
  at: string;
  actor: { id: string; name: string; dot: string };
  movieId: number;
  movieTitle: string;
  moviePoster: string | null;
  reviewId?: string;
  commentId?: string | null;
  parentId?: string | null;
  owner?: { id: string; name: string };
  final?: number;
  genre?: string;
  ends?: { high: { name: string; value: number }; low: { name: string; value: number } } | null;
  value?: number;
  criterion?: string;
  excerpt?: string | null;
};

export const notifications = {
  all: () =>
    api<{
      items: Notice[];
      unread: number;
      account: { verifyEmail: boolean };
      clubs: number;
    }>('/api/notices'),
  seen: () => post<{ ok: true }>('/api/notices/seen', {}),
  clear: () => post<{ ok: true }>('/api/notices/clear', {}),
};

export const social = {
  all: () =>
    capi<{ comments: ReviewComment[]; votes: ReviewVote[]; commentLikes: CommentLike[] }>('/social'),
  comment: (reviewId: string, body: string, parentId?: string | null) =>
    cpost<ReviewComment>(`/social/reviews/${reviewId}/comments`, { body, parentId: parentId ?? null }),
  uncomment: (id: string) => cdel(`/social/comments/${id}`),
  likeComment: (id: string, liked: boolean) =>
    capi<{ liked: boolean }>(`/social/comments/${id}/like`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liked }),
    }),
  vote: (reviewId: string, value: 1 | -1 | 0) =>
    capi<{ vote: ReviewVote | null }>(`/social/reviews/${reviewId}/vote`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    }),
};

export type Review = {
  id: string;
  reviewerId: string;
  reviewerName: string;
  reviewerDot: string;
  movieId: number;
  movieTitle: string;
  movieYear: number | null;
  movieGenre: string;
  movieOriginal?: string | null;
  movieEnglish?: string | null;
  moviePoster: string | null;
  movieDirector: string | null;
  movieRuntime: number | null;
  scores: Record<string, number>;
  final: number;
  date: string;
  comment: string;
  breakdown: BreakdownRow[];
  crowd?: { score: number; votes: number } | null;
  origin?: { name: string | null; slug: string | null } | null;
};

export type Movie = {
  id: number;
  title: string;
  original?: string | null;
  english?: string | null;
  year: number | null;
  genre: string;
  genres?: string[];
  poster: string | null;
  director?: string | null;
  runtime?: number | null;
  overview?: string | null;
  cast?: { name: string }[];
  crew?: Record<string, string[]>;
  crowd?: { score: number; votes: number } | null;
  trailerUrl?: string | null;
  watch?: {
    link: string | null;
    streaming: Provider[];
  } | null;
  stale?: boolean;
};

export type Provider = {
  id: number;
  name: string;
  logo: string | null;
  url?: string | null;
};

export type WatchItem = {
  id: number;
  title: string;
  original?: string | null;
  english?: string | null;
  year: number | null;
  genre: string;
  poster: string | null;
  addedAt?: string;
  wanters: string[];
};

let currentClub: string | null = null;

export function setClub(slug: string | null) {
  currentClub = slug;
}

export function clubPath(path: string) {
  if (!currentClub) throw new Error('Nenhum clube aberto — clubPath foi chamado cedo demais.');
  return `/api/c/${encodeURIComponent(currentClub)}${path}`;
}

export const hasClub = () => currentClub !== null;

export const capi = <T>(path: string, opts?: RequestInit) => api<T>(clubPath(path), opts);

export const cpost = <T>(path: string, body: unknown) => post<T>(clubPath(path), body);

export const cdel = (path: string) => del(clubPath(path));

export const cput = <T>(path: string, body: unknown) =>
  api<T>(clubPath(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const send = (path: string, opts?: RequestInit) =>
  fetch(urlFor(path), {
    ...opts,
    credentials: credentialsMode,
    headers: { ...authHeaders(), ...(opts?.headers || {}) },
  });

export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  let res = await send(path, opts);

  if (res.status === 401 && hasPair() && !path.endsWith('/auth/refresh')) {
    if (await refreshSession()) res = await send(path, opts);
  }

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
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

export function finalOf(criteria: Criterion[], scores: Record<string, number>) {
  const weight = totalWeight(criteria, scores);
  return weight ? weightedSum(criteria, scores) / weight : 0;
}

export function weightedSum(criteria: Criterion[], scores: Record<string, number>) {
  return criteria.reduce(
    (sum, c) => (typeof scores[c.key] === 'number' ? sum + scores[c.key] * c.w : sum),
    0
  );
}

export function totalWeight(criteria: Criterion[], scores: Record<string, number>) {
  return criteria.reduce((sum, c) => (typeof scores[c.key] === 'number' ? sum + c.w : sum), 0);
}

export function fmt(n: number) {
  return Number(n).toFixed(1).replace('.', ',');
}

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

const LEGACY_DOTS = ['#b5abfc', '#cfd3e5', '#a7a1db', '#b2b6ca', '#d2cefd', '#9397ab'];
const REEL = [
  '#e0362c', '#4fa98c', '#e8b44a', '#7bc47f', '#c77dd6',
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
