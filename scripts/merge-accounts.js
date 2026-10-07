try { require('node:process').loadEnvFile('.env'); } catch { }

const db = require('../db');
const auth = require('../auth');

const arg = name => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const has = name => process.argv.includes(name);

const el = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

async function contas(filtro) {
  const rows = await db.prepare(`
    SELECT r.id, r.name, r.email, r.created_at,
           r.google_sub IS NOT NULL AS google,
           r.password_hash IS NOT NULL AS senha,
           r.pin_hash IS NOT NULL AS pin,
           r.email_verified,
           (SELECT COUNT(*) FROM reviews v WHERE v.reviewer_id = r.id) AS fichas,
           (SELECT COUNT(*) FROM review_comments c WHERE c.reviewer_id = r.id) AS ditos,
           (SELECT GROUP_CONCAT(c.name, ', ') FROM club_members m
              JOIN clubs c ON c.id = m.club_id WHERE m.reviewer_id = r.id) AS salas
    FROM reviewers r
    ORDER BY r.created_at ASC
  `).all();

  const q = (filtro || '').toLowerCase();
  return q
    ? rows.filter(r => String(r.name).toLowerCase().includes(q) || String(r.email || '').toLowerCase().includes(q))
    : rows;
}

function mostrar(rows) {
  if (!rows.length) return console.log('Nenhuma conta com esse nome.');
  for (const r of rows) {
    const portas = [
      Number(r.google) ? 'Google' : null,
      Number(r.senha) ? 'senha' : null,
      Number(r.pin) ? 'PIN' : null,
    ].filter(Boolean);
    console.log('');
    console.log(`  ${r.name}`);
    console.log(`    id       ${r.id}`);
    console.log(`    e-mail   ${r.email || '—'}${Number(r.email_verified) ? ' (confirmado)' : ''}`);
    console.log(`    entra por ${portas.length ? portas.join(' + ') : 'NADA — conta adormecida'}`);
    console.log(`    criada em ${r.created_at}`);
    console.log(`    tem      ${el(Number(r.fichas), 'ficha', 'fichas')}, ${el(Number(r.ditos), 'comentário', 'comentários')}`);
    console.log(`    salas    ${r.salas || '—'}`);
  }
  console.log('');
}

async function colisoes(oldId, newId) {
  const um = (sql, ...args) => db.prepare(sql).get(...args).then(r => Number(r.n));
  return {
    salas: await um(
      `SELECT COUNT(*) AS n FROM club_members a JOIN club_members b
         ON b.club_id = a.club_id AND b.reviewer_id = ?
       WHERE a.reviewer_id = ?`, oldId, newId
    ),
    fichas: await um(
      `SELECT COUNT(*) AS n FROM reviews a JOIN reviews b
         ON b.club_id = a.club_id AND b.movie_id = a.movie_id AND b.reviewer_id = ?
       WHERE a.reviewer_id = ?`, oldId, newId
    ),
    votos: await um(
      `SELECT COUNT(*) AS n FROM review_votes a JOIN review_votes b
         ON b.review_id = a.review_id AND b.reviewer_id = ?
       WHERE a.reviewer_id = ?`, oldId, newId
    ),
    curtidas: await um(
      `SELECT COUNT(*) AS n FROM comment_likes a JOIN comment_likes b
         ON b.comment_id = a.comment_id AND b.reviewer_id = ?
       WHERE a.reviewer_id = ?`, oldId, newId
    ),
  };
}

async function main() {
  await db.ready;

  if (has('--list') || process.argv.length <= 2) {
    console.log(process.env.TURSO_DATABASE_URL ? 'Banco: Turso (produção)' : 'Banco: arquivo local');
    mostrar(await contas(arg('--list')));
    console.log('Depois: node scripts/merge-accounts.js --old <id> --new <id>');
    return;
  }

  const oldId = arg('--old');
  const newId = arg('--new');
  if (!oldId || !newId) {
    console.error('Faltou --old <id> ou --new <id>. Use --list para achá-los.');
    process.exit(1);
  }
  if (oldId === newId) {
    console.error('Os dois ids são o mesmo.');
    process.exit(1);
  }

  const [antiga, nova] = await Promise.all([
    db.prepare('SELECT * FROM reviewers WHERE id = ?').get(oldId),
    db.prepare('SELECT * FROM reviewers WHERE id = ?').get(newId),
  ]);
  if (!antiga) { console.error(`Não existe conta com o id ${oldId}.`); process.exit(1); }
  if (!nova) { console.error(`Não existe conta com o id ${newId}.`); process.exit(1); }

  if (!nova.google_sub && !nova.password_hash) {
    console.error('A conta em --new não entra por Google nem por senha: ela não tem credencial para emprestar.');
    console.error('Provavelmente os ids estão trocados. Confira com --list.');
    process.exit(1);
  }

  console.log('');
  console.log('  FICA (absorve tudo)');
  mostrar([(await contas()).find(r => r.id === oldId)]);
  console.log('  SOME (empresta a credencial e é apagada)');
  mostrar([(await contas()).find(r => r.id === newId)]);

  const bate = await colisoes(oldId, newId);
  const perdas = Object.entries(bate).filter(([, n]) => n > 0);
  if (perdas.length) {
    console.log('  ATENÇÃO — o que a conta nova tem e a antiga já tinha será DESCARTADO:');
    for (const [o, n] of perdas) console.log(`    ${n} em ${o}`);
    console.log('');
  } else {
    console.log('  Nada colide: tudo da conta nova cabe na antiga.\n');
  }

  if (!has('--apply')) {
    console.log('  Ensaio. Nada foi alterado.');
    console.log('  Antes de aplicar: npm run backup');
    console.log('  Para aplicar de verdade, repita o comando com --apply\n');
    return;
  }

  const out = await auth.claimAccount(newId, oldId);
  if (out.error) { console.error('Falhou:', out.error); process.exit(1); }

  console.log(`  Pronto. A conta que ficou é ${out.reviewer.name} (${out.reviewer.id}).`);
  console.log(`  Ela entra agora por ${out.reviewer.email || 'senha'}.`);
  console.log('  O nome, o retrato e a bio são os da conta antiga — dá para trocar no perfil.\n');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[merge] falhou:', err.message);
    process.exit(1);
  });
