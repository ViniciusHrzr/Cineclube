const express = require('express');
const auth = require('../auth');
const clubs = require('../clubs');
const notices = require('../notices');
const wrap = require('../wrap');

const router = express.Router();

/* ══════════════════════════════════════════════════════════════════════════
   O SINO DA REDE: uma lista só, de todas as salas de que a pessoa é, cada linha
   dizendo de qual sala veio. O sino de um clube continua existindo
   (`/api/c/<slug>/notifications`) e é a mesma construção — ver notices.js.

   As marcas d'água continuam por sala, e isso é escolha: uma marca única por
   pessoa faria abrir este sino marcar como visto o que aconteceu numa sala que
   ela nem abriu. Abrir o da rede move TODAS de uma vez, que é a mesma coisa
   dita de propósito.

   São sete consultas por sala — vinte e uma para quem está em três clubes, num
   banco de dezenas de linhas por tabela. O dia em que alguém estiver em
   cinquenta salas, a troca certa é uma consulta com `club_id IN (...)`, não um
   teto menor.

   `account` carrega o que a CONTA está esperando, hoje confirmar o e-mail. Vem
   separado da lista ordenada por tempo porque não é um acontecimento, é um
   estado: não tem hora, não envelhece, e não pode ser dispensado pelo botão de
   limpar — limpar esconde o que já aconteceu, e isto ainda não aconteceu.
   ══════════════════════════════════════════════════════════════════════════ */

/** Quantas salas uma leitura considera. Além disto, o sino vira um relatório. */
const MAX_CLUBS = 20;

router.get('/', auth.requireSession, wrap(async (req, res) => {
  const me = req.session.reviewer_id;
  const minhas = (await clubs.mineStmt.all(me)).slice(0, MAX_CLUBS);

  const porSala = await Promise.all(
    minhas.map(async sala => {
      const manda = sala.role === 'admin' || !!req.session.is_admin;
      const out = await notices.forClub({ clubId: sala.id, me, manda });
      return { sala, ...out };
    })
  );

  const items = [];
  let unread = 0;
  for (const { sala, items: doClube, seenAt } of porSala) {
    unread += notices.unreadIn(doClube, seenAt);
    for (const item of doClube) {
      items.push({
        ...item,
        /* O id ganha a sala na frente: dois clubes podem ter avisos com o mesmo
           id local, e uma chave repetida numa lista é a tela desenhando um item
           e escondendo o outro. */
        id: `${sala.id}|${item.id}`,
        club: { name: sala.name, slug: sala.slug },
      });
    }
  }

  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  /* O aviso de conta não entra na contagem de não-lidos pela mesma razão que
     não entra na lista: ele não chegou, ele É. Mas conta para o sino acender —
     senão haveria algo esperando por você e nada dizendo isso. */
  const account = { verifyEmail: !!req.session.email && !req.session.email_verified };

  res.json({
    items: items.slice(0, notices.LIMIT),
    unread: unread + (account.verifyEmail ? 1 : 0),
    account,
    /* Quantas salas foram lidas, para a tela poder dizer de onde veio cada
       linha só quando houver mais de uma. */
    clubs: minhas.length,
  });
}));

/* As duas movem a marca em TODAS as salas da pessoa, porque é isso que a lista
   que ela acabou de ver continha. Limpar não apaga nada: o que ele move é uma
   data por sala. */
router.post('/clear', auth.requireSession, wrap(async (req, res) => {
  const me = req.session.reviewer_id;
  const minhas = await clubs.mineStmt.all(me);
  await Promise.all(minhas.map(sala => notices.markCleared(sala.id, me)));
  res.json({ ok: true });
}));

router.post('/seen', auth.requireSession, wrap(async (req, res) => {
  const me = req.session.reviewer_id;
  const minhas = await clubs.mineStmt.all(me);
  await Promise.all(minhas.map(sala => notices.markSeen(sala.id, me)));
  res.json({ ok: true });
}));

module.exports = router;
