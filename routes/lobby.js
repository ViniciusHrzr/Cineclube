const express = require('express');
const lobby = require('../lobby');
const lobbySeries = require('../lobbySeries');
const wrap = require('../wrap');

const router = express.Router();

/* Fora do escopo de clube, como `/api/clubs`: é a tela de ANTES de haver uma
   sala, e exigir estar dentro de uma seria uma porta trancada por dentro. Sem
   sessão exigida — tudo que sai daqui é o que as salas emprestaram de propósito
   (ver lobby.js).

   Uma chamada e não seis: são seis agregações, e seis viagens na porta de
   entrada é a porta pensando antes de abrir. */
router.get('/', wrap(async (_req, res) => {
  res.json(await lobby.snapshot());
}));

/* Só o que a rede sabe sobre o filme — as fichas e a conta. Sinopse e trailer
   são do TMDB e o cliente já tem uma rota para eles, pública e com cache;
   duplicar aqui pagaria a mesma requisição de novo e teria uma segunda cópia da
   conversão para manter. */
router.get('/film/:movieId', wrap(async (req, res) => {
  const out = await lobby.film(req.params.movieId);
  if (!out) return res.status(400).json({ error: 'Filme inválido.' });
  res.json(out);
}));

/* Rota separada e não um parâmetro `?universo=`: são duas consultas diferentes
   sobre duas tabelas diferentes, e um `if` na entrada esconderia isso atrás de
   uma URL que finge ser uma só. Os clubes não se dividem entre as duas — o que
   difere é o que a rede FEZ em cada universo. */
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
