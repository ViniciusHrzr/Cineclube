const express = require('express');
const lobby = require('../lobby');
const lobbySeries = require('../lobbySeries');
const wrap = require('../wrap');

const router = express.Router();

/* ══════════════════════════════════════════════════════════════════════════
   O saguão numa resposta.

   Fora do escopo de clube, como `/api/clubs` e pelo mesmo motivo: é a tela de
   ANTES de haver uma sala, e exigir estar dentro de uma para ver o que a rede
   está fazendo seria uma porta trancada por dentro.

   Sem sessão exigida. Tudo que sai daqui é o que as salas emprestaram de
   propósito (ver lobby.js), e um dia isto vira a vitrine que se vê deslogado.

   Uma chamada e não seis: são seis agregações, e seis viagens na porta de
   entrada é a porta pensando antes de abrir.
   ══════════════════════════════════════════════════════════════════════════ */
router.get('/', wrap(async (_req, res) => {
  res.json(await lobby.snapshot());
}));

/* ── um filme, visto pela rede ────────────────────────────────────────────
   O que abre ao clicar num cartaz da parede. Só o que a rede sabe sobre aquele
   filme — as fichas e a conta —, porque sinopse e trailer são do TMDB e o
   cliente já tem uma rota para eles (`/api/catalog/movie/:id`), pública e com
   cache. Duplicar a chamada ao TMDB aqui seria pagar a mesma requisição de novo
   e ter uma segunda cópia da conversão para manter.

   Sem sessão, como o resto deste arquivo: tudo que sai daqui é o que as salas
   emprestaram de propósito. A parede de quem aparece assinado é a mesma da
   ficha em destaque — ver `film` em lobby.js. */
router.get('/film/:movieId', wrap(async (req, res) => {
  const out = await lobby.film(req.params.movieId);
  if (!out) return res.status(400).json({ error: 'Filme inválido.' });
  res.json(out);
}));

/* ── o mesmo saguão, pela outra lente ─────────────────────────────────────
   Mesma forma de resposta, outro acervo. Uma rota separada e não um parâmetro
   `?universo=`: são duas consultas diferentes sobre duas tabelas diferentes, e
   um `if` na entrada esconderia isso atrás de uma URL que finge ser uma só.

   Os clubes não se dividem entre as duas — um clube é um clube. O que estas
   duas rotas devolvem diferente é o que a rede FEZ em cada universo. */
router.get('/series', wrap(async (_req, res) => {
  res.json(await lobbySeries.snapshot());
}));

/** Uma série, vista pela rede. O par de `/film/:movieId`. */
router.get('/show/:showId', wrap(async (req, res) => {
  const out = await lobbySeries.show(req.params.showId);
  if (!out) return res.status(400).json({ error: 'Série inválida.' });
  res.json(out);
}));

/* Um episódio, visto pela rede. É o que a folha mostra quando alguém troca de
   "clube" para "todas" — outra pergunta que a da série, e não um filtro dela. */
router.get('/episode/:showId/:season/:episode', wrap(async (req, res) => {
  const { showId, season, episode } = req.params;
  const out = await lobbySeries.episode(showId, season, episode);
  if (!out) return res.status(400).json({ error: 'Episódio inválido.' });
  res.json(out);
}));

module.exports = router;
