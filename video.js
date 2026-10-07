function bestVideo(results) {
  const rank = v => (v.type === 'Trailer' ? 0 : 2) + (v.official ? 0 : 1);
  return (
    (results || [])
      .filter(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'))
      .sort((a, b) => rank(a) - rank(b))[0] || null
  );
}

module.exports = { bestVideo };
