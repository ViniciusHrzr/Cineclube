const MAX_KEYS = 50_000;
const SWEEP_MS = 60_000;

const hits = new Map();

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) if (entry.until <= now) hits.delete(key);
}, SWEEP_MS);
sweeper.unref?.();

function identityOf(req, by) {
  if (by === 'ip') return 'ip:' + (req.ip || 'sem-endereco');
  const who = req.session?.reviewer_id;
  return who ? 'p:' + who : 'ip:' + (req.ip || 'sem-endereco');
}

function saying(seconds) {
  if (seconds < 90) return `${Math.max(1, seconds)}s`;
  const min = Math.ceil(seconds / 60);
  return `${min} minuto${min === 1 ? '' : 's'}`;
}

function take(key, max, windowMs, now = Date.now()) {
  const entry = hits.get(key);
  if (!entry || entry.until <= now) {
    if (hits.size >= MAX_KEYS) hits.clear();
    hits.set(key, { n: 1, until: now + windowMs });
    return { ok: true };
  }
  if (entry.n >= max) {
    return { ok: false, retryAfter: Math.ceil((entry.until - now) / 1000) };
  }
  entry.n += 1;
  return { ok: true };
}

function limit({ name, max, windowMs, by = 'account', message }) {
  return function limited(req, res, next) {
    const verdict = take(`${name}|${identityOf(req, by)}`, max, windowMs);
    if (verdict.ok) return next();

    const espera = saying(verdict.retryAfter);
    res.setHeader('Retry-After', String(verdict.retryAfter));
    res.status(429).json({
      error: message ? message(espera) : `Você está indo rápido demais. Tente de novo em ${espera}.`,
      retryAfter: verdict.retryAfter,
    });
  };
}

function reset() {
  hits.clear();
}

function stopTimers() {
  clearInterval(sweeper);
}

module.exports = { limit, take, reset, stopTimers, MAX_KEYS };
