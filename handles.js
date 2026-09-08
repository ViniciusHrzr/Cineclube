/* ══════════════════════════════════════════════════════════════════════════
   O nome pelo qual se chama alguém numa menção.

   Não é uma coluna, e isso é a decisão inteira: um apelido não é fato sobre a
   pessoa isolada, é fato sobre ela DENTRO deste clube — "Bruno" só serve
   enquanto não houver dois Brunos. Gravado, dois membros poderiam acabar com o
   mesmo apelido e uma menção passaria a apontar para quem chegou primeiro, em
   silêncio. Derivado do conjunto, a unicidade é garantida por construção.

   A regra: primeiro nome; havendo empate, mais a palavra seguinte
   ("brunosa", "brunolima"); persistindo (nome completo idêntico), o suficiente
   do id para separar. Sem acento e em minúsculas — ninguém alcança as teclas
   mortas no meio de uma frase.
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

/** Handles únicos de um clube inteiro, na forma `{ [reviewerId]: handle }`. */
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
      /* Sozinho no balde E sem colidir com apelido já entregue numa passada
         anterior: sem a segunda metade, "Ana" e "Ana Reis" poderiam receber o
         mesmo "ana" em rodadas diferentes. */
      const taken = Object.values(chosen).includes(handle);
      if (people.length === 1 && !taken) chosen[people[0].id] = handle;
      else next.push(...people);
    }
    pending = next;
  }

  /* Nomes idênticos: o id desempata. Feio de propósito — é o caso que não
     acontece. */
  for (const person of pending) {
    const base = norm(person.parts.join('')) || 'membro';
    chosen[person.id] = `${base}${norm(person.id).slice(-3)}`;
  }
  return chosen;
}

/* Os ids mencionados num texto, sem repetição.

   O `@` só conta no começo ou depois de algo que não é letra, senão um e-mail
   colado no meio do comentário chamaria alguém chamado Gmail. O maior apelido
   ganha primeiro, senão "@brunosa" viraria "@bruno" mais um "sa" perdido. */
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
