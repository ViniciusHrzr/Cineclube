const express = require('express');
const lobby = require('../lobby');
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

module.exports = router;
