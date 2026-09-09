/* A escolha do vídeo, para os dois mundos.

   tmdb.js e series.js são deliberadamente separados — outros caminhos, outros
   nomes de campo —, mas a lista de vídeos que o TMDB devolve tem a mesma forma
   nos dois, e a regra de qual deles é O trailer é a mesma pergunta. Escrita
   duas vezes, ela divergiria na terceira.

   Trailer antes de teaser, e oficial antes de não oficial. O teaser entra só na
   falta de trailer: é o mesmo gesto pela metade, e meio trailer ainda decide se
   alguém quer ver. O que não é do YouTube não entra — é o único player que a
   política de conteúdo desta casa deixa emoldurar. */
function bestVideo(results) {
  const rank = v => (v.type === 'Trailer' ? 0 : 2) + (v.official ? 0 : 1);
  return (
    (results || [])
      .filter(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'))
      .sort((a, b) => rank(a) - rank(b))[0] || null
  );
}

module.exports = { bestVideo };
