/* ══════════════════════════════════════════════════════════════════════════
   O clube ao vivo. O mesmo desenho da sala de projeção (screening.js),
   generalizado para o resto do produto.

   Um quadro daqui não carrega o comentário que foi escrito: carrega a palavra
   `social`, e quem recebe vai buscar a coleção pela rota que já existe. É uma
   viagem a mais, de propósito. Mandar o dado daria a toda escrita DUAS
   representações — a da rota e a do quadro — que teriam de concordar para
   sempre, e o servidor teria de decidir por conexão o que aquela pessoa pode
   ver, porque um quadro é fan-out e o sino é privado. O dia em que
   `/api/social` ficar caro demais é o dia de mandar o delta, e este comentário
   fica errado.

   Sem estado nenhum: é um cano. Reiniciar não perde nada além das conexões
   abertas, e o EventSource do lado de lá reconecta e busca tudo de novo.
   ══════════════════════════════════════════════════════════════════════════ */

/* Conexão aberta é memória parada, e a instância tem 512 MB. Três por pessoa
   cobre uma segunda aba e uma terceira que não fechou direito. */
const MAX_STREAMS_TOTAL = 24;
const MAX_STREAMS_PER_VIEWER = 3;
/** Impede o proxy da frente de fechar uma conexão que ele acha que morreu. */
const PING_MS = 20_000;

/* Nada fora desta lista é emitido.

   `screening` é a exceção que confirma o desenho: a sala de projeção tem cano
   próprio, mais rico e mais caro, e entrar nele te PÕE dentro dela (ver o
   `attach` em routes/screening.js). Quem não está assistindo não pode pagar
   isso, nem aparecer na lista de quem está — então, para fora, a sala manda só
   uma palavra daqui: "a sala mudou". */
/* `shows` é o universo de séries inteiro numa palavra: a fila e o que cada um
   viu. Um aviso só por episódio marcado seria um por toque numa maratona, e o
   que a outra tela precisa saber é "isto mudou", não o quê. */
const KINDS = new Set(['social', 'reviews', 'watchlist', 'reviewers', 'screening', 'club', 'shows']);

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

/* Uma conexão pertence a um clube, e `emit` compara. A comparação É a
   proteção; ela não pode virar filtro do lado do cliente.

   Sem ela, um aviso de `social` diria "alguém escreveu alguma coisa em algum
   lugar": quem recebesse levaria 403 ao buscar e ainda assim ficaria sabendo
   que aquele clube tem gente ativa agora — o que num clube privado não é dele. */
function subscribe(res, reviewerId, clubId) {
  const entry = { res, reviewerId, clubId };
  streams.add(entry);
  /* Um primeiro quadro imediato: é ele que faz o navegador considerar a conexão
     aberta de verdade, e é o que a tela usa para saber que está ao vivo. */
  write(entry, { kind: 'hello', at: Date.now() });
  return entry;
}

function unsubscribe(entry) {
  streams.delete(entry);
}

/* Chamado DEPOIS da escrita e nunca antes: um quadro emitido antes do commit
   manda todo mundo buscar um estado que ainda não existe, e ninguém avisa de
   novo.

   Não pode falhar de forma que derrube a rota que o chamou — a escrita já
   aconteceu, e um 500 depois disso seria o produto mentindo sobre uma coisa que
   deu certo.

   `by` viaja para a tela decidir o que fazer com o próprio eco. Não é filtro de
   privacidade. */
function emit(kind, by = null, clubId = null) {
  if (!KINDS.has(kind) || !streams.size) return;
  /* Sem clube, nada sai. O modo de falhar de um caminho que ninguém está
     olhando tem de ser o silêncio: uma rota que esqueça o argumento produz uma
     tela que não atualiza — defeito visível — e não um clube privado aparecendo
     no cano de estranhos. */
  if (!clubId) return;
  const frame = { kind, by: by || null, at: Date.now() };
  for (const entry of streams) if (entry.clubId === clubId) write(entry, frame);
}

/* Uma batida só, e ela é para o proxy. Ao contrário da sala de projeção, aqui
   não há deriva a corrigir: não existe relógio correndo, existe uma coleção
   parada que está certa até alguém mudá-la. */
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
