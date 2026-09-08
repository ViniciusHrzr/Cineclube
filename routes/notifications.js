const express = require('express');
const auth = require('../auth');
const clubs = require('../clubs');
const notices = require('../notices');
const wrap = require('../wrap');

const router = express.Router({ mergeParams: true });

/* O sino de UMA sala. A construção mora em `notices.js` porque as duas leituras
   — esta e a da rede — são a mesma montagem sobre as mesmas tabelas.

   A interface usa `/api/notices`, que junta todas as salas. Esta rota continua
   porque "o sino do clube" é uma pergunta legítima, e é o que os testes deste
   arquivo exercitam. */

router.get('/', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  const me = req.session.reviewer_id;
  /* Os pedidos de entrada só são buscados para quem pode respondê-los: para o
     resto eles não são aviso, são a lista de quem quer entrar num clube — que
     não é assunto de quem não decide isso. */
  const manda = req.club.isClubAdmin || !!req.session.is_admin;

  const { items, seenAt, clearedAt } = await notices.forClub({
    clubId: req.club.id,
    me,
    manda,
  });

  res.json({ items, unread: notices.unreadIn(items, seenAt), seenAt, clearedAt });
}));

/* Esvazia a lista de quem pediu, e de mais ninguém. Não apaga comentário, voto
   nem curtida: um aviso é a projeção de uma linha que pertence a outra pessoa.
   O que ele move é uma data, e o que chegar depois volta a aparecer. */
router.post('/clear', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  await notices.markCleared(req.club.id, req.session.reviewer_id);
  const row = await notices.marksFor(req.club.id, req.session.reviewer_id);
  res.json({
    seenAt: row?.notifications_seen_at || null,
    clearedAt: row?.notifications_cleared_at || null,
  });
}));

/* Marca tudo como visto. Uma data, não uma lista: ver o sino aberto é ver o que
   está nele, e um item por item aqui seria estado que ninguém pediu. */
router.post('/seen', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  await notices.markSeen(req.club.id, req.session.reviewer_id);
  const row = await notices.marksFor(req.club.id, req.session.reviewer_id);
  res.json({ seenAt: row?.notifications_seen_at || null });
}));

module.exports = router;
