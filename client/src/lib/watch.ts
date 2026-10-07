type Door = { match: RegExp; url: (query: string) => string };

const DOORS: Door[] = [
  { match: /^netflix/i, url: q => `https://www.netflix.com/search?q=${q}` },
  {
    match: /prime video/i,
    url: q => `https://www.primevideo.com/search?phrase=${q}`,
  },
  { match: /^globoplay/i, url: q => `https://globoplay.globo.com/busca/?q=${q}` },
  { match: /^apple tv/i, url: q => `https://tv.apple.com/br/search?term=${q}` },
  { match: /^paramount/i, url: q => `https://www.paramountplus.com/br/search/?q=${q}` },
  { match: /^crunchyroll/i, url: q => `https://www.crunchyroll.com/search?q=${q}` },
];

export function watchDoor(provider: string, title: string, fallback: string | null) {
  const door = DOORS.find(d => d.match.test(provider));
  if (!door) return fallback;
  return door.url(encodeURIComponent(title));
}

export function goesToService(provider: string) {
  return DOORS.some(d => d.match.test(provider));
}
