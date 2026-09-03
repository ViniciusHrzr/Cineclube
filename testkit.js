const crypto = require('node:crypto');
const db = require('./db');
const auth = require('./auth');

/* ══════════════════════════════════════════════════════════════════════════
   A montagem que todo teste de API precisa agora.

   Antes disto, entrar num teste era uma linha: `POST /api/reviewers` com um PIN,
   e pronto — havia um clube só, e estar cadastrado era estar dentro dele. Com
   clubes são três coisas diferentes: existir uma conta, existir uma sala, e a
   conta estar naquela sala.

   ── por que direto no banco, e não pela API ────────────────────────────────
   Porque não é isto que os testes estão testando. Um arquivo que verifica se
   apagar um comentário leva as respostas junto não deveria falhar porque o fluxo
   do Google mudou, e fazer a montagem pela rota acopla todos eles à porta de
   entrada. A entrada tem os próprios testes.

   `signIn` é a exceção parcial e deliberada: ela chama `accountForGoogle`, que é
   a função real que cria contas no produto. Assim a montagem continua passando
   pelo caminho de verdade sem passar pelo Google.

   ── e por que este arquivo não mora em test/ ───────────────────────────────
   Porque `node --test` varre todo .js debaixo de uma pasta chamada test e
   trataria isto como uma suíte — e uma suíte sem `CINECLUBE_DB` definido abre o
   banco DE VERDADE. Cada teste aponta o banco para um arquivo descartável antes
   de exigir qualquer coisa; um arquivo lá dentro que rodasse sozinho não faria
   isso, e escreveria no clube.
   ══════════════════════════════════════════════════════════════════════════ */

let seq = 0;

/** Uma conta com sessão aberta. `cookie` vai em todo pedido dela. */
async function signIn(name) {
  const who = name || `Sócio ${++seq}`;
  const { reviewer } = await auth.accountForGoogle({
    sub: 'g-' + crypto.randomUUID(),
    email: `p${++seq}-${crypto.randomUUID().slice(0, 8)}@exemplo.com`,
    name: who,
    verified: true,
  });
  const token = await auth.createSession(reviewer.id);
  return { ...reviewer, cookie: `cc_session=${token}` };
}

/** A mesma conta, com o administrador da INSTALAÇÃO ligado. */
async function signInAdmin(name) {
  const p = await signIn(name || `Chefe ${++seq}`);
  await db.prepare('UPDATE reviewers SET is_admin = 1 WHERE id = ?').run(p.id);
  return { ...p, is_admin: 1 };
}

/** Uma sala. Quem funda é ADM dela, como na rota de verdade. */
async function makeClub({ name, owner, visibility = 'private' } = {}) {
  const label = name || `Clube ${++seq}`;
  const id = 'c' + crypto.randomUUID();
  const slug = await db.freeSlug(label);
  await db
    .prepare('INSERT INTO clubs (id, name, slug, visibility, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(id, label, slug, visibility, owner || null);
  if (owner) await join(id, owner, 'admin');
  return { id, name: label, slug, visibility };
}

/** Põe alguém dentro de uma sala. */
async function join(clubId, reviewerId, role = 'member') {
  await db
    .prepare(
      `INSERT INTO club_members (club_id, reviewer_id, role) VALUES (?, ?, ?)
       ON CONFLICT (club_id, reviewer_id) DO UPDATE SET role = excluded.role`
    )
    .run(clubId, reviewerId, role);
}

/** O prefixo das rotas com escopo. `pathIn(club)('/reviews')`. */
const pathIn = club => p => `/api/c/${club.slug}${p}`;

module.exports = { signIn, signInAdmin, makeClub, join, pathIn };
