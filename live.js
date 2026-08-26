/* ══════════════════════════════════════════════════════════════════════════
   O clube ao vivo.

   Tudo o que uma pessoa faz aqui é sobre as outras — comentar a ficha de
   alguém, discordar de uma nota, curtir um texto, pôr um filme na fila — e até
   agora nada disso atravessava a rede sozinho. Cada aba carregava o clube uma
   vez, no boot, e ficava com aquela fotografia até alguém apertar F5. O sino
   perguntava de noventa em noventa segundos, o feed de dois em dois minutos, e
   o resto não perguntava nunca: um comentário escrito às 21h04 aparecia para o
   resto do clube quando o resto do clube resolvesse recarregar a página.

   Isto é o caminho de volta, e ele já existia inteiro na sala de projeção —
   ver screening.js. O mesmo desenho, generalizado para o resto do produto.

   ── o que trafega aqui é um aviso, não um dado ──────────────────────────
   Um quadro daqui não carrega o comentário que foi escrito: carrega a palavra
   `social`. Quem recebe vai buscar a coleção pela rota que já existe.

   Parece uma viagem a mais e é, de propósito. Mandar o dado significaria que
   toda escrita do produto passa a ter DUAS representações — a da rota e a do
   quadro — que precisam concordar para sempre, e cada campo novo teria de ser
   somado nos dois lugares ou a tela ao vivo ficaria diferente da tela
   recarregada. Pior: o servidor teria de decidir, por conexão, o que aquela
   pessoa pode ver, porque um quadro é fan-out e o sino é privado.

   Buscando de novo não há duas verdades: existe a rota, e o aviso só diz
   "agora". Num clube de seis pessoas, `/api/social` é uma resposta de dezenas
   de kB que já era buscada a cada boot. O dia em que essa conta não fechar é o
   dia em que vale mandar o delta — e este comentário fica errado.

   ── por que não existe estado aqui ──────────────────────────────────────
   A sala de projeção tem um quarto — posição, status, quem está dentro — e
   precisa dele. Este arquivo não tem nenhum: é um cano. Quem reinicia o
   servidor não perde nada além das conexões abertas, e o EventSource do lado
   de lá reconecta sozinho e busca tudo de novo ao reabrir, que é exatamente o
   que uma aba que dormiu precisa fazer.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── tetos ────────────────────────────────────────────────────────────────
   Uma conexão aberta é memória parada, e a instância tem 512 MB. O clube é de
   seis pessoas: vinte e quatro é generoso, e três por pessoa cobre uma segunda
   aba e uma terceira que não fechou direito. */
const MAX_STREAMS_TOTAL = 24;
const MAX_STREAMS_PER_VIEWER = 3;
/** Impede o proxy da frente de fechar uma conexão que ele acha que morreu. */
const PING_MS = 20_000;

/** As coisas sobre as quais este cano fala. Nada fora daqui é emitido. */
const KINDS = new Set(['social', 'reviews', 'watchlist', 'reviewers']);

const streams = new Set();

function write(entry, payload) {
  try {
    entry.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
    /* Uma conexão que morreu entre a checagem e a escrita não é motivo para
       derrubar um broadcast; o handler de close recolhe ela. */
  }
}

function countFor(reviewerId) {
  let n = 0;
  for (const entry of streams) if (entry.reviewerId === reviewerId) n += 1;
  return n;
}

/** True quando cabe mais uma conexão. */
function canSubscribe(reviewerId) {
  return streams.size < MAX_STREAMS_TOTAL && countFor(reviewerId) < MAX_STREAMS_PER_VIEWER;
}

function subscribe(res, reviewerId) {
  const entry = { res, reviewerId };
  streams.add(entry);
  /* Um primeiro quadro imediato, antes de qualquer coisa acontecer no clube. É
     ele que faz o navegador considerar a conexão aberta de verdade, e é o que a
     tela usa para saber que está ao vivo em vez de supor. */
  write(entry, { kind: 'hello', at: Date.now() });
  return entry;
}

function unsubscribe(entry) {
  streams.delete(entry);
}

/* ── o aviso ──────────────────────────────────────────────────────────────
   Chamado DEPOIS da escrita e nunca antes: um quadro emitido antes do commit
   manda todo mundo buscar um estado que ainda não existe, e o resultado é o
   clube inteiro com a versão anterior na tela e nenhum segundo aviso a
   caminho.

   Não é esperado por ninguém e não pode falhar de forma que derrube a rota que
   o chamou — a escrita já aconteceu, e uma resposta 500 depois disso seria o
   produto mentindo sobre uma coisa que deu certo.

   `by` viaja para a tela poder decidir o que fazer com o próprio eco. Não é
   filtro de privacidade: não vai nada aqui que já não seja legível. */
function emit(kind, by = null) {
  if (!KINDS.has(kind) || !streams.size) return;
  const frame = { kind, by: by || null, at: Date.now() };
  for (const entry of streams) write(entry, frame);
}

/* Uma batida só, e ela é para o proxy. Ao contrário da sala de projeção, aqui
   não há nada a corrigir sozinho: entre dois avisos não existe deriva porque
   não existe relógio correndo — existe uma coleção parada que está certa até
   alguém mudá-la. */
let timer = null;

function startTimers() {
  if (timer) return;
  timer = setInterval(() => {
    for (const entry of streams) {
      try {
        entry.res.write(': ping\n\n');
      } catch {
        /* recolhida no close */
      }
    }
  }, PING_MS);
  // O teste importa este módulo e depois espera `node --test` terminar.
  timer.unref?.();
}

function stopTimers() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  KINDS,
  MAX_STREAMS_TOTAL,
  MAX_STREAMS_PER_VIEWER,
  canSubscribe,
  subscribe,
  unsubscribe,
  emit,
  startTimers,
  stopTimers,
  streams,
};
