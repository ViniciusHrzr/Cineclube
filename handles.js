/* ══════════════════════════════════════════════════════════════════════════
   O nome pelo qual se chama alguém.

   Uma menção é escrita à mão, no meio de uma frase, por quem está com pressa —
   "@beren o terceiro ato desmonta". Ninguém digita "Beren Costa" ali, e ninguém
   deveria: o que se usa para chamar uma pessoa é o primeiro nome dela.

   ── por que isto não é uma coluna ───────────────────────────────────────
   Porque um apelido não é um fato sobre a pessoa isolada, é um fato sobre ela
   DENTRO deste clube: "Bruno" só serve enquanto não houver dois Brunos. Guardar
   isso numa coluna criaria a possibilidade de dois membros com o mesmo apelido
   gravado, e o dia em que isso acontecesse uma menção passaria a apontar para
   quem chegou primeiro em silêncio.

   Derivado do conjunto inteiro, então a unicidade é uma propriedade garantida
   pela construção e não uma regra que alguém precisa lembrar de aplicar.

   ── a regra ─────────────────────────────────────────────────────────────
   Primeiro nome. Havendo empate, o primeiro nome mais a primeira palavra
   seguinte — "brunosa", "brunolima". Persistindo o empate (duas pessoas com
   exatamente o mesmo nome completo), entra o suficiente do id para separar, que
   é feio e é o caso que nunca acontece num clube de seis amigos.

   Sem acento e em minúsculas, porque é assim que se digita com pressa. É a
   mesma normalização que a busca do acervo usa, pela mesma razão: ninguém
   alcança as teclas mortas no meio de uma frase.
   ══════════════════════════════════════════════════════════════════════════ */

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // O que sobra tem de ser digitável de um fôlego: sem espaço, sem pontuação.
    .replace(/[^a-z0-9]/g, '');
}

const words = name => String(name || '').trim().split(/\s+/).filter(Boolean);

/**
 * Handles únicos para um clube inteiro, na forma `{ [reviewerId]: handle }`.
 * `reviewers` é qualquer lista de objetos com `id` e `name`.
 */
function handlesFor(reviewers) {
  const list = (reviewers || []).map(r => ({ id: String(r.id), parts: words(r.name) }));

  /* Uma passada por vez, cada uma usando mais uma palavra do nome. Quem já está
     sozinho no próprio apelido para de crescer; só os empatados continuam. */
  const chosen = {};
  let pending = list;
  for (let depth = 1; depth <= 3 && pending.length; depth++) {
    const bucket = {};
    for (const person of pending) {
      const handle = norm(person.parts.slice(0, depth).join('')) || 'membro';
      (bucket[handle] ||= []).push(person);
    }
    const next = [];
    for (const [handle, people] of Object.entries(bucket)) {
      /* Sozinho no balde E sem colidir com um apelido já entregue numa passada
         anterior — sem a segunda metade, "Ana" e "Ana Reis" poderiam receber o
         mesmo "ana" em rodadas diferentes. */
      const taken = Object.values(chosen).includes(handle);
      if (people.length === 1 && !taken) chosen[people[0].id] = handle;
      else next.push(...people);
    }
    pending = next;
  }

  /* Nomes idênticos: o id desempata. Feio de propósito — é o caso que não
     acontece, e resolvê-lo com elegância custaria mais do que ele vale. */
  for (const person of pending) {
    const base = norm(person.parts.join('')) || 'membro';
    chosen[person.id] = `${base}${norm(person.id).slice(-3)}`;
  }
  return chosen;
}

/* ── quem foi chamado num texto ───────────────────────────────────────────
   Devolve os ids mencionados, sem repetição.

   O `@` só conta no começo do texto ou depois de algo que não é letra: sem
   isso, um e-mail colado no meio de um comentário chamaria alguém chamado
   Gmail. O maior apelido ganha primeiro, senão "@brunosa" seria lido como
   "@bruno" mais um "sa" perdido. */
function mentionedIn(body, handles) {
  const text = String(body || '');
  if (!text.includes('@')) return [];

  const byHandle = Object.entries(handles).sort((a, b) => b[1].length - a[1].length);
  const found = new Set();

  for (const [id, handle] of byHandle) {
    const at = new RegExp(`(^|[^a-zA-Z0-9@._-])@${handle}(?![a-z0-9])`, 'i');
    if (at.test(norm2(text))) found.add(id);
  }
  return [...found];
}

/* O texto passa pela mesma normalização dos apelidos, mas preservando os
   separadores: sem os espaços não haveria como saber onde uma menção termina. */
function norm2(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

module.exports = { handlesFor, mentionedIn };
