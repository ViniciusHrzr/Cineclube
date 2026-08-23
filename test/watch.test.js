const test = require('node:test');
const assert = require('node:assert/strict');

const { watchIn } = require('../tmdb');

/* ── one service, one logo ───────────────────────────────────────────────
   JustWatch is a catalogue of ways to pay and the club asks a much smaller
   question, so the answer is squeezed on the way through: resellers, ad tiers
   and plan tiers all collapse onto the service they are a version of. Every
   payload below is shaped like a real one, because these rules are string
   rules and string rules rot the moment somebody renames a plan. */

const P = (provider_id, provider_name, display_priority) => ({
  provider_id, provider_name, display_priority, logo_path: `/${provider_id}.jpg`
});

const wrap = br => ({ results: { BR: { link: 'https://tmdb/watch', ...br } } });
const names = list => list.map(p => p.name);

test('a country with nothing at all answers null', () => {
  assert.equal(watchIn(wrap({})), null);
  assert.equal(watchIn({ results: {} }), null);
  assert.equal(watchIn(undefined), null);
});

test('only Brazil is read, however many countries came back', () => {
  const payload = {
    results: {
      US: { link: 'x', flatrate: [P(8, 'Netflix', 0)] },
      BR: { link: 'y', flatrate: [P(337, 'Disney Plus', 2)] }
    }
  };
  assert.deepEqual(names(watchIn(payload).streaming), ['Disney Plus']);
});

test('subscription and rental stay apart', () => {
  const watch = watchIn(wrap({
    flatrate: [P(8, 'Netflix', 0)],
    rent: [P(3, 'Google Play Movies', 14)],
    buy: [P(2, 'Apple TV Store', 9)]
  }));
  assert.deepEqual(names(watch.streaming), ['Netflix']);
  // Sorted by JustWatch's priority, so buy can precede rent in the joined list.
  assert.deepEqual(names(watch.paid), ['Apple TV Store', 'Google Play Movies']);
});

/* Free and ad-supported are a different deal to JustWatch and the same answer
   to somebody asking whether they have to pay again tonight. */
test('free and ad-supported count as streaming', () => {
  const watch = watchIn(wrap({ free: [P(283, 'Crunchyroll', 5)], ads: [P(613, 'Pluto TV', 7)] }));
  assert.deepEqual(names(watch.streaming), ['Crunchyroll', 'Pluto TV']);
});

/* This is Inception's real payload, trimmed: the same subscription arriving
   three times because three storefronts resell it. */
test('storefronts that resell a service are dropped', () => {
  const watch = watchIn(wrap({
    flatrate: [
      P(1899, 'HBO Max', 8),
      P(1825, 'HBO Max Amazon Channel', 49),
      P(1889, 'Universal+ Amazon Channel', 83)
    ]
  }));
  assert.deepEqual(names(watch.streaming), ['HBO Max']);
});

/* And this is Fight Club's: Netflix listed once plainly and once as a plan. */
test('plan tiers collapse onto the service they are a tier of', () => {
  const watch = watchIn(wrap({
    flatrate: [
      P(8, 'Netflix', 0),
      P(531, 'Paramount Plus', 3),
      P(1796, 'Netflix Standard', 40),
      P(2303, 'Paramount Plus Premium', 60)
    ]
  }));
  assert.deepEqual(names(watch.streaming), ['Netflix', 'Paramount Plus']);
});

test('an ad tier is folded into the service, not listed beside it', () => {
  const watch = watchIn(wrap({
    flatrate: [P(119, 'Amazon Prime Video', 1), P(2100, 'Amazon Prime Video with Ads', 80)]
  }));
  assert.deepEqual(names(watch.streaming), ['Amazon Prime Video']);
});

/* The collapse must never eat a genuinely different service. These two are one
   word apart and are not the same thing, which is why the tier rule matches on
   a word boundary rather than on any shared prefix. */
test('two services with overlapping names both survive', () => {
  const watch = watchIn(wrap({
    flatrate: [P(119, 'Amazon Prime Video', 1)],
    rent: [P(10, 'Amazon Video', 13)]
  }));
  assert.deepEqual(names(watch.streaming), ['Amazon Prime Video']);
  assert.deepEqual(names(watch.paid), ['Amazon Video']);
});

test('the list is capped before it becomes a directory', () => {
  const many = Array.from({ length: 12 }, (_, i) => P(i + 1, `Serviço ${i + 1}`, i));
  assert.equal(watchIn(wrap({ flatrate: many })).streaming.length, 6);
});

test('the first entry wins, and JustWatch decides which one that is', () => {
  // Same service, listed out of order: the lower display_priority is the one
  // JustWatch considers primary, and it has to survive whatever order we got.
  const watch = watchIn(wrap({
    flatrate: [P(1796, 'Netflix Standard', 40), P(8, 'Netflix', 0)]
  }));
  assert.deepEqual(names(watch.streaming), ['Netflix']);
});

test('a logo path becomes a URL, and a missing one stays null', () => {
  const watch = watchIn(wrap({
    flatrate: [P(8, 'Netflix', 0), { provider_id: 9, provider_name: 'Sem logo', display_priority: 1 }]
  }));
  assert.match(watch.streaming[0].logo, /^https:\/\/image\.tmdb\.org\/t\/p\/w92\/8\.jpg$/);
  assert.equal(watch.streaming[1].logo, null);
});

test('the link out is carried through for the attribution to hang on', () => {
  assert.equal(watchIn(wrap({ flatrate: [P(8, 'Netflix', 0)] })).link, 'https://tmdb/watch');
});
