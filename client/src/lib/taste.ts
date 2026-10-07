import type { Review, Reviewer } from '@/lib/api';

export const FLOOR = { ends: 3, crowd: 4, shared: 3 } as const;

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

export function takesOf(reviews: Review[], reviewerId: string) {
  return reviews
    .filter(r => r.reviewerId === reviewerId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function endsOf(reviews: Review[], reviewerId: string) {
  const mine = takesOf(reviews, reviewerId);
  if (mine.length < FLOOR.ends) return null;
  const byScore = [...mine].sort((a, b) => b.final - a.final || String(b.date).localeCompare(String(a.date)));
  const best = byScore[0];
  const worst = byScore[byScore.length - 1];
  if (best.id === worst.id || best.final - worst.final < 1) return null;
  return { best, worst };
}

export function crowdGapOf(reviews: Review[], reviewerId: string) {
  const pairs = takesOf(reviews, reviewerId)
    .filter(r => r.crowd && Number.isFinite(r.crowd.score))
    .map(r => ({ review: r, gap: r.final - (r.crowd as { score: number }).score }));
  if (pairs.length < FLOOR.crowd) return null;

  const gap = mean(pairs.map(p => p.gap));
  const widest = pairs.reduce((a, b) => (Math.abs(b.gap) > Math.abs(a.gap) ? b : a));
  return { gap, n: pairs.length, widest: widest.review, widestGap: widest.gap };
}

export function spreadOf(reviews: Review[], reviewerId: string) {
  const mine = takesOf(reviews, reviewerId);
  if (!mine.length) return null;
  const bands: Review[][] = Array.from({ length: 10 }, () => []);
  for (const r of mine) {
    bands[Math.min(9, Math.max(0, Math.floor(r.final)))].push(r);
  }
  for (const band of bands) band.sort((a, b) => b.final - a.final);
  const finals = mine.map(r => r.final);
  return {
    bands,
    peak: Math.max(...bands.map(b => b.length)),
    low: Math.min(...finals),
    high: Math.max(...finals),
    avg: mean(finals),
    n: mine.length,
  };
}

export type Affinity = {
  person: Reviewer;
  gap: number;
  shared: number;
  clash: { title: string; movieId: number; mine: number; theirs: number } | null;
};

export function affinityOf(
  reviews: Review[],
  reviewers: Reviewer[],
  reviewerId: string
): Affinity[] {
  const mine = new Map(takesOf(reviews, reviewerId).map(r => [r.movieId, r]));
  if (!mine.size) return [];

  const out: Affinity[] = [];
  for (const person of reviewers) {
    if (person.id === reviewerId) continue;
    const gaps: number[] = [];
    let clash: Affinity['clash'] = null;
    let worst = -1;
    for (const r of reviews) {
      if (r.reviewerId !== person.id) continue;
      const ours = mine.get(r.movieId);
      if (!ours) continue;
      const d = Math.abs(ours.final - r.final);
      gaps.push(d);
      if (d > worst) {
        worst = d;
        clash = { title: r.movieTitle, movieId: r.movieId, mine: ours.final, theirs: r.final };
      }
    }
    if (gaps.length < FLOOR.shared) continue;
    out.push({ person, gap: mean(gaps), shared: gaps.length, clash: worst >= 1 ? clash : null });
  }
  return out.sort((a, b) => a.gap - b.gap || b.shared - a.shared);
}

export type Clash = {
  movieId: number;
  title: string;
  poster: string | null;
  mine: number;
  theirs: number;
  gap: number;
};

export function clashesOf(reviews: Review[], meId: string, themId: string): Clash[] {
  const mine = new Map(takesOf(reviews, meId).map(r => [r.movieId, r]));
  const out: Clash[] = [];
  for (const r of takesOf(reviews, themId)) {
    const ours = mine.get(r.movieId);
    if (!ours) continue;
    out.push({
      movieId: r.movieId,
      title: r.movieTitle,
      poster: r.moviePoster,
      mine: ours.final,
      theirs: r.final,
      gap: Math.abs(ours.final - r.final),
    });
  }
  return out.sort((a, b) => b.gap - a.gap || a.title.localeCompare(b.title));
}

export function genresOf(reviews: Review[], reviewerId: string) {
  const acc = new Map<string, number[]>();
  for (const r of takesOf(reviews, reviewerId)) {
    const list = acc.get(r.movieGenre) ?? [];
    list.push(r.final);
    acc.set(r.movieGenre, list);
  }
  return [...acc.entries()]
    .map(([genre, finals]) => ({ genre, n: finals.length, avg: mean(finals) }))
    .sort((a, b) => b.n - a.n || b.avg - a.avg);
}

export function memberSince(createdAt: string | null | undefined) {
  if (!createdAt) return null;
  const at = new Date(createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z');
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}
