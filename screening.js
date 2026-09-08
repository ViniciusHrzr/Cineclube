/* ══════════════════════════════════════════════════════════════════════════
   The screening room. Uma sala por clube: cada uma com o seu filme, a sua
   posição e as suas pessoas, e nada de uma atravessa para a outra.

   Vive em memória e não no banco: uma sessão são as duas horas em que ela está
   acontecendo. Na instância grátis um cold start acabaria com ela de qualquer
   jeito, e uma tabela só registraria que uma sessão sem espectador existiu um
   dia. Em memória, uma sala vazia simplesmente deixa de existir.

   ── the one idea in here ──────────────────────────────────────────────────
   The position is never stored ticking. What is stored is a position and the
   instant it was true, and the current position is derived from those two on
   demand. A stored counter would need a timer, every tick would be a chance to
   drift, and a client that reconnected between ticks would get a stale number.
   Derived, a client that has been away for an hour computes it just as
   correctly as one that never left.

   Everything a client sends is validated HERE and not on the screen: this state
   is shared and broadcast, so one bad request does not break one browser, it
   breaks everybody's. A NaN in `position` poisons the derivation for the whole
   club at once.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── ceilings ─────────────────────────────────────────────────────────────
   The room fans out: a single request is re-emitted to every open connection,
   so anything unbounded on the way in is an amplifier on the way out. */

/** Magnets, URLs and source tags. Long enough for a magnet with trackers. */
const MAX_TEXT = 1024;
/** Per member. Enough for a second tab and a stale one that has not closed. */
const MAX_STREAMS_PER_VIEWER = 3;
/** The club is four people. Twenty is already generous. */
const MAX_STREAMS_TOTAL = 20;
const RATE_WINDOW_MS = 5000;
const RATE_MAX = 10;
/** Keeps the proxy from closing a connection it thinks has gone quiet. */
const PING_MS = 20_000;
/** The unprompted correction: late and drifting clients converge on this. */
const SYNC_MS = 5000;

/* A file usually runs longer than the runtime TMDB reports — different cuts,
   credits, an extra frame of black. The clamp is a guard against nonsense, not
   a statement about the film, so it leaves room. */
const RUNTIME_SLACK_SECONDS = 900;

const COMMANDS = new Set(['play', 'pause', 'seek']);

/* O servidor não interpreta nenhuma: esta lista existe para que o cano só
   carregue o que a outra ponta sabe ouvir.

   `want` é a única que não é do WebRTC, é do produto: quem quer imagem e não
   tem pede, e quem transmite responde com uma oferta. É isso que faz a
   reconexão ser o mesmo caminho da conexão inicial. */
const SIGNALS = new Set(['want', 'offer', 'answer', 'ice']);
/* Folgado para um SDP (~5 kB) e absurdo para um candidato ICE, que é como um
   teto deve ser: não está aqui para ajustar o protocolo, e sim para que nada
   sem tamanho atravesse a sala. */
const MAX_SIGNAL = 16 * 1024;
/* O aperto de mão é uma rajada: dezenas de candidatos em poucos segundos, por
   pessoa da sala. O teto de comandos (dez em cinco segundos) mataria a conexão
   antes de ela existir, então a sinalização tem o balde dela. */
const SIGNAL_WINDOW_MS = 10_000;
const SIGNAL_MAX = 400;

/* Anything that ends up in a `src`, or beside one. `javascript:` and `data:`
   are the two that turn a shared string into somebody else's code, and the
   room hands every string it accepts to every other member's browser. */
const URL_SCHEMES = new Set(['http:', 'https:', 'blob:', 'magnet:']);

/* The link the room hands to whoever arrives. Narrower than the set above:
   `blob:` is a reference into one browser's memory, so sharing one would be
   handing everybody else a URL that resolves to nothing in their tab. */
const LINK_SCHEMES = new Set(['http:', 'https:', 'magnet:']);
/* A magnet with a full tracker list runs past a kilobyte — the one the club
   pasted was 1.3 kB — and a truncated magnet is not a shorter magnet, it is a
   broken one. So links get their own ceiling and are refused rather than cut. */
const MAX_LINK = 4096;

/* Legendas de um longa dão 40 a 120 kB de WebVTT. Recusado inteiro, como um
   link: meia legenda não é uma legenda menor. O body parser na frente aceita
   1 MB, então o teto que vale é este. */
const MAX_SUBTITLE = 512 * 1024;

function blankRoom(clubId) {
  return {
    clubId,
    open: false,
    movie: null,
    status: 'paused',
    /** Seconds. True as of `updatedAt`, not as of now — see the header. */
    position: 0,
    updatedAt: Date.now(),
    /** Bumped by every mutation, so a client can drop a frame that overtook it. */
    revision: 0,
    /* What the club is watching from, when that is a thing that can be handed
       over: a magnet or a URL. Null while nobody has one, and null forever for a
       file on somebody's disk — those bytes cannot be shared by naming them. */
    link: null,
    /* The club's subtitle: `{ id, name, vtt }`, or null while there is none.
       Unlike the link this is the content and not a pointer to it, because there
       is nowhere else for it to live — the file came off somebody's disk. What
       the snapshot carries is still only a pointer; see `snapshot`. */
    subtitle: null,
    /* ── quem está transmitindo a própria tela ─────────────────────────────
       Nulo quase sempre. Quando não é, a sala muda de natureza: em vez de
       quatro cópias andando juntas por um relógio, é UM vídeo saindo da máquina
       de uma pessoa para as outras por WebRTC.

       O servidor não vê um quadro. O que ele guarda é o nome de quem está no
       comando, porque é o que decide para quem os outros pedem imagem. */
    live: null,
    viewers: new Map(),
    /* Um Map e não um Set porque existe recado com destinatário: o aperto de
       mão do WebRTC é uma conversa entre DUAS pessoas, e mandá-la para a sala
       inteira seria cada navegador tendo de peneirar oferta que não é dele. */
    streams: new Map(),
  };
}

const rooms = new Map();

/* A sala de um clube, criada na primeira vez que alguém pergunta por ela. Um
   quarto vazio é barato; o que custa é ele ficar existindo depois que a última
   pessoa saiu, e disso cuida `sweep`. */
function roomFor(clubId) {
  let held = rooms.get(clubId);
  if (!held) {
    held = blankRoom(clubId);
    rooms.set(clubId, held);
  }
  return held;
}

/* Uma sala fechada, sem ninguém dentro e sem conexão nenhuma não é uma sala, é
   memória. Chamado quando alguém sai — que é o único momento em que uma sala
   pode ter acabado de ficar vazia. */
function sweep(room) {
  if (room.open || room.streams.size || room.viewers.size) return;
  rooms.delete(room.clubId);
}

/* ── derivation ───────────────────────────────────────────────────────────── */

function durationSeconds(room) {
  const minutes = room.movie?.runtime;
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : null;
}

/** Where the film is, right now. The whole point of the module. */
function positionAt(room, now = Date.now()) {
  if (room.status !== 'playing') return room.position;
  const elapsed = (now - room.updatedAt) / 1000;
  return clampPosition(room, room.position + elapsed);
}

/** Refuses NaN and Infinity, and keeps the number inside the film. */
function clampPosition(room, seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return 0;
  const duration = durationSeconds(room);
  const ceiling = duration == null ? Number.MAX_SAFE_INTEGER : duration + RUNTIME_SLACK_SECONDS;
  return Math.min(n, ceiling);
}

/** Trims and caps a string a member sent. Null for anything else. */
function text(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_TEXT);
}

/** A source string is only allowed if its scheme is one we chose to allow. */
function isAllowedSource(value) {
  const t = text(value);
  if (!t) return false;
  try {
    return URL_SCHEMES.has(new URL(t).protocol);
  } catch {
    // Not a URL at all. A bare source tag (an infohash, a size:duration pair)
    // is legitimate and carries no scheme, so it is judged by shape instead.
    return /^[\w:.\-]{1,128}$/.test(t);
  }
}

/** A link worth handing to somebody else's browser. Refused, never trimmed. */
function isShareableLink(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_LINK) return false;
  try {
    return LINK_SCHEMES.has(new URL(trimmed).protocol);
  } catch {
    return false;
  }
}

/* ── mutation ─────────────────────────────────────────────────────────────
   Every one of these fixes the position as it stands before changing anything,
   which is what makes "pause" mean "pause here" rather than "pause at whatever
   the last command said". */

function stamp(room, now) {
  room.updatedAt = now;
  room.revision += 1;
}

function open(room, movie, now = Date.now()) {
  room.open = true;
  room.movie = movie;
  room.status = 'paused';
  room.position = 0;
  // A link belongs to the film it was opened for, never to the next one. So
  // does a subtitle, and rather more obviously.
  room.link = null;
  room.subtitle = null;
  // E a transmissão pela mesma razão: quem estava com a tela no ar estava com
  // ela para o filme anterior.
  room.live = null;
  stamp(room, now);
  broadcastState(room);
}

/* Quem chega depois de todo mundo se acomodar encontrava um seletor vazio e uma
   pergunta que a sala já sabia responder. O primeiro a apontar algo
   compartilhável deixa o ponteiro aqui.

   `null` limpa, que é o que acontece quando a fonte é um arquivo no disco de
   alguém: não há o que entregar, e um ponteiro velho é pior que nenhum. */
function setLink(room, link, now = Date.now()) {
  if (link !== null && !isShareableLink(link)) return false;
  room.link = link === null ? null : link.trim();
  stamp(room, now);
  broadcastState(room);
  return true;
}

/* A única coisa desta tela pequena o bastante para viajar: o filme são
   gigabytes e fica no disco de onde veio, a legenda são cem kilobytes de texto.

   O que se compartilha é o ARQUIVO, não a sincronia. O ajuste fica com cada
   membro porque é fato sobre a CÓPIA dele: duas pessoas com rips diferentes do
   mesmo título precisam de deslocamentos diferentes, e a correção de uma
   aplicada a todos quebraria as três contra as quais ela não foi medida.

   `null` limpa para todo mundo — a legenda é da sala, então sair só da tela de
   um membro não é uma coisa que ela saiba fazer. */
function setSubtitle(room, subtitle, now = Date.now()) {
  if (subtitle === null) {
    room.subtitle = null;
    stamp(room, now);
    broadcastState(room);
    return true;
  }
  const name = text(subtitle?.name);
  const vtt = typeof subtitle?.vtt === 'string' ? subtitle.vtt : null;
  if (!name || !vtt || !vtt.trim() || vtt.length > MAX_SUBTITLE) return false;

  stamp(room, now);
  /* Identified by the revision it arrived on, which is already monotonic. A
     client compares it against the one it holds and fetches only on a
     difference — including the difference between "no subtitle" and "one it
     has never seen", which is how somebody arriving mid-film gets it. */
  room.subtitle = { id: room.revision, name, vtt };
  broadcastState(room);
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════
   A TELA DE ALGUÉM, AO VIVO — o outro modo da sala, e o oposto dele em tudo.
   No modo arquivo cada pessoa tem a própria cópia e o que se sincroniza é um
   relógio; aqui existe UM vídeo e todo mundo vê o mesmo quadro porque é o mesmo
   quadro. Não há posição, não há seek, não há o que sincronizar.

   O servidor não carrega mídia: a imagem vai direto de navegador a navegador
   por WebRTC, e o que passa por aqui são os poucos quilobytes do aperto de mão.
   É a diferença entre uma instância de 512 MB servir um clube e não servir
   nenhum.

   Uma pessoa e não uma lista: duas telas ao vivo ao mesmo tempo é a pergunta
   "qual das duas estamos vendo?" sem resposta, e cada uma custaria a subida de
   quem transmite vezes o número de pessoas na sala.
   ══════════════════════════════════════════════════════════════════════════ */

/** Assumir a transmissão. Falha se outra pessoa já está com ela. */
function startLive(room, session, now = Date.now()) {
  if (room.live && room.live.hostId !== session.reviewer_id) return false;
  room.live = {
    hostId: session.reviewer_id,
    hostName: session.name,
    hostDot: session.dot,
    since: now,
  };
  stamp(room, now);
  broadcastState(room);
  return true;
}

/* Largar a transmissão. Só quem está com ela — e é por isso que isto recebe um
   id em vez de simplesmente zerar: sem a comparação, qualquer pessoa na sala
   derrubaria a tela de quem está transmitindo apertando um botão na dela. */
function stopLive(room, reviewerId, now = Date.now()) {
  if (!room.live || room.live.hostId !== reviewerId) return false;
  room.live = null;
  stamp(room, now);
  broadcastState(room);
  return true;
}

/* O servidor é o carteiro e não o assunto: não lê a oferta, não sabe o que é um
   candidato ICE, não guarda nada. Garante as duas coisas que um carteiro
   garante — que o remetente está na sala, e que o destinatário também.

   `data` viaja como veio, e o teto existe porque toda string que entra aqui sai
   multiplicada pelas conexões abertas. */
function signal(room, fromId, toId, kind, data) {
  if (!SIGNALS.has(kind)) return false;
  if (!room.viewers.has(fromId) || !room.viewers.has(toId)) return false;
  const payload = JSON.stringify(data ?? null);
  if (payload.length > MAX_SIGNAL) return false;
  return sendTo(room, toId, { type: 'signal', from: fromId, kind, data }) > 0;
}

function close(room, now = Date.now()) {
  room.open = false;
  room.movie = null;
  room.status = 'paused';
  room.position = 0;
  room.link = null;
  room.subtitle = null;
  /* Encerrar a sessão derruba a transmissão junto. Uma tela ao vivo sem filme
     aberto seria uma sala escura com alguém ainda no ar dentro dela. */
  room.live = null;
  // The viewers survive: they are the people with a connection open, and
  // closing the film does not disconnect anybody.
  for (const viewer of room.viewers.values()) {
    viewer.ready = true;
    viewer.sourceTag = null;
  }
  stamp(room, now);
  broadcastState(room);
}

function play(room, at, now = Date.now()) {
  room.position = at == null ? positionAt(room, now) : clampPosition(room, at);
  room.status = 'playing';
  stamp(room, now);
  broadcastState(room);
}

function pause(room, at, now = Date.now()) {
  room.position = at == null ? positionAt(room, now) : clampPosition(room, at);
  room.status = 'paused';
  stamp(room, now);
  broadcastState(room);
}

function seek(room, to, now = Date.now()) {
  room.position = clampPosition(room, to);
  // Status is deliberately untouched: dragging the bar while the film runs
  // should land you somewhere else in a film that is still running.
  stamp(room, now);
  broadcastState(room);
}

/** Applies a command a member sent. Returns false if it was not a real one. */
function command(room, type, position, now = Date.now()) {
  if (!COMMANDS.has(type)) return false;
  if (!room.open) return false;
  if (type === 'play') play(room, position, now);
  else if (type === 'pause') pause(room, position, now);
  else seek(room, position, now);
  return true;
}

/* ── a roda de carregar, que agora só informa ─────────────────────────────
   A sala parava sozinha quando um membro travava e voltava sozinha quando ele
   voltava. O argumento era certo no papel — seguir sem quem travou é a
   dessincronia que este módulo existe para evitar — e o clube passou noites
   sentado no resultado: é um laço de controle com quatro navegadores e um
   enxame dentro, e um laço de controle oscila. Todo amortecedor melhorou o
   número de vezes por noite sem mudar a natureza da coisa.

   Então a sala parou de opinar: isto só GRAVA quem está carregando e o que cada
   um abriu, e o painel mostra. Nada aqui muda `status` — o filme só para quando
   uma pessoa para. Quem travou não fica para trás: o corretor de deriva do
   player dele o traz de volta assim que ele conseguir tocar. */
function setReady(room, reviewerId, ready, sourceTag) {
  const viewer = room.viewers.get(reviewerId);
  if (!viewer) return;

  viewer.ready = ready !== false;
  if (sourceTag !== undefined) {
    viewer.sourceTag = isAllowedSource(sourceTag) ? text(sourceTag) : null;
  }

  broadcastState(room);
}

/* ── who is in the room ───────────────────────────────────────────────────
   Counted by connection and not by person, because one member with the app
   open in two tabs is one member: removing them when the first tab closes
   would empty the room out from under somebody who is still watching. */

function attach(room, session) {
  const existing = room.viewers.get(session.reviewer_id);
  if (existing) {
    // A second tab is not a second person, and nothing about the room changed.
    existing.streams += 1;
    return existing;
  }
  const viewer = {
    id: session.reviewer_id,
    name: session.name,
    dot: session.dot,
    /* Pronto até dizerem o contrário. Chegar marcado como carregando poria uma
       roda no painel ao lado do nome de quem acabou de abrir a aba e ainda nem
       escolheu de onde vai ver. */
    ready: true,
    sourceTag: null,
    streams: 1,
    since: Date.now(),
  };
  room.viewers.set(session.reviewer_id, viewer);
  /* Somebody arriving is news for the people already here. Without this the
     room only redraws on the next change — and the sync frames carry no
     viewers, so a member who joined during a quiet stretch could stay invisible
     for the whole film. */
  broadcastState(room);
  return viewer;
}

/* Sair não mexe no filme. Havia aqui uma retomada, porque a sala se prendia na
   roda de quem saiu; não se prende mais. O que sai daqui é uma pessoa do
   painel. */
function detach(room, reviewerId) {
  const viewer = room.viewers.get(reviewerId);
  if (!viewer) return;
  viewer.streams -= 1;
  if (viewer.streams > 0) return;
  room.viewers.delete(reviewerId);
  /* Quem transmitia foi embora, e com ele foi a imagem: as conexões saíram da
     máquina dele. Deixar o campo de pé seria a sala apontando para uma fonte
     que não existe, e cada pessoa esperando um vídeo que ninguém vai mandar. */
  if (room.live?.hostId === reviewerId) room.live = null;
  broadcastState(room);
  // A última pessoa saiu de uma sala fechada: o quarto some com ela.
  sweep(room);
}

/* ── what a client is told ────────────────────────────────────────────────── */

function snapshot(room, now = Date.now()) {
  return {
    type: 'state',
    open: room.open,
    movie: room.movie,
    status: room.status,
    position: positionAt(room, now),
    revision: room.revision,
    link: room.link,
    /* O anúncio, não o arquivo. Este snapshot é reemitido a cada mutação da
       sala, e cem kilobytes de legenda em cada uma, vezes todo mundo conectado,
       é exatamente o fan-out que os tetos do topo existem para evitar. A sala
       diz QUE há legenda e qual; quem não a tem busca uma vez, por HTTP. */
    subtitle: room.subtitle ? { id: room.subtitle.id, name: room.subtitle.name } : null,
    /* Quem está com a tela no ar, ou null. É o campo que faz cada navegador
       decidir o próprio papel sem perguntar nada: quem se vê aqui transmite,
       quem não se vê pede imagem a quem está. */
    live: room.live,
    // The client measures its own offset against this; without it, one member
    // with a crooked clock drifts permanently and nothing can tell why.
    serverTime: now,
    viewers: [...room.viewers.values()].map(v => ({
      id: v.id,
      name: v.name,
      dot: v.dot,
      ready: v.ready,
      sourceTag: v.sourceTag,
    })),
  };
}

/* ── the fan-out ──────────────────────────────────────────────────────────
   Server-sent events rather than a socket: the server speaks and the client
   occasionally answers, which is the shape SSE has, and it costs no dependency.
   EventSource also reconnects on its own, which matters on an instance that
   sleeps — and an open stream is an open request, so the free instance does not
   idle out in the middle of a film. */

function write(res, payload) {
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
    // A connection that died between the check and the write is not an error
    // worth failing a broadcast over; the close handler will collect it.
  }
}

function broadcastState(room) {
  if (!room.streams.size) return;
  const frame = snapshot(room);
  for (const res of room.streams.keys()) write(res, frame);
}

/* Um recado para UMA pessoa, em TODAS as abas dela: a outra ponta não sabe em
   qual aba a pessoa está olhando, e uma oferta entregue à aba errada é um
   aperto de mão que nunca fecha. A aba que não espera aquele recado o descarta. */
function sendTo(room, reviewerId, payload) {
  let delivered = 0;
  for (const [res, id] of room.streams) {
    if (id !== reviewerId) continue;
    write(res, payload);
    delivered += 1;
  }
  return delivered;
}

/** Quantas conexões existem em todas as salas somadas. */
function totalStreams() {
  let n = 0;
  for (const r of rooms.values()) n += r.streams.size;
  return n;
}

/* Dois tetos que medem coisas diferentes: o por pessoa é sobre abas esquecidas
   e continua sendo por sala; o total é sobre a memória da instância, e por isso
   é somado sobre TODAS as salas — vinte por clube seria o mesmo que não ter
   teto. */
function canSubscribe(room, reviewerId) {
  if (totalStreams() >= MAX_STREAMS_TOTAL) return false;
  const viewer = room.viewers.get(reviewerId);
  return !viewer || viewer.streams < MAX_STREAMS_PER_VIEWER;
}

function subscribe(room, res, reviewerId) {
  room.streams.set(res, reviewerId);
  write(res, snapshot(room));
}

function unsubscribe(room, res) {
  room.streams.delete(res);
}

/* Two heartbeats with two different jobs: the comment ping is for the proxy,
   which closes a connection it believes has gone silent; the sync frame is the
   room stating where the film is, so a client that drifted or came back from a
   locked phone converges without having to ask. */
let timers = null;

function startTimers() {
  if (timers) return;
  /* Um par de temporizadores para todas as salas: o trabalho é proporcional a
     quantas conexões existem, e criar intervalos junto com cada quarto seria
     pagar agendamento por clube para fazer a mesma varredura. */
  timers = [
    setInterval(() => {
      for (const room of rooms.values()) {
        for (const res of room.streams) {
          try { res.write(': ping\n\n'); } catch { /* collected on close */ }
        }
      }
    }, PING_MS),
    setInterval(() => {
      const now = Date.now();
      for (const room of rooms.values()) {
        if (!room.streams.size || !room.open) continue;
        const frame = {
          type: 'sync',
          status: room.status,
          position: positionAt(room, now),
          revision: room.revision,
          serverTime: now,
        };
        for (const res of room.streams) write(res, frame);
      }
    }, SYNC_MS),
  ];
  // Timers must not be the reason the process refuses to exit — the tests
  // import this module and then expect `node --test` to finish.
  timers.forEach(t => t.unref?.());
}

function stopTimers() {
  timers?.forEach(clearInterval);
  timers = null;
}

/* ── rate limiting ────────────────────────────────────────────────────────
   A member holding the seek bar generates a command per frame, and every one
   of them is re-emitted to everyone. The bucket is per person and deliberately
   crude: it exists to stop a runaway loop, not to police ordinary use. */

const buckets = new Map();

function withinRate(reviewerId, now = Date.now()) {
  const bucket = buckets.get(reviewerId);
  if (!bucket || now - bucket.since > RATE_WINDOW_MS) {
    buckets.set(reviewerId, { count: 1, since: now });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_MAX;
}

/* O mesmo mecanismo, balde separado. Dividir com os comandos faria o aperto de
   mão gastar as dez fichas que existem para o play e o pause — e a pessoa que
   acabou de entrar na transmissão perderia o controle da sessão por ter se
   conectado a ela. */
const signalBuckets = new Map();

function withinSignalRate(reviewerId, now = Date.now()) {
  const bucket = signalBuckets.get(reviewerId);
  if (!bucket || now - bucket.since > SIGNAL_WINDOW_MS) {
    signalBuckets.set(reviewerId, { count: 1, since: now });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= SIGNAL_MAX;
}

/** Tests only: esvazia o prédio inteiro. */
function reset() {
  rooms.clear();
  buckets.clear();
  signalBuckets.clear();
}

module.exports = {
  MAX_TEXT,
  MAX_LINK,
  MAX_SUBTITLE,
  MAX_STREAMS_PER_VIEWER,
  MAX_STREAMS_TOTAL,
  COMMANDS,
  rooms,
  roomFor,
  blankRoom,
  totalStreams,
  positionAt,
  clampPosition,
  text,
  isAllowedSource,
  isShareableLink,
  setLink,
  setSubtitle,
  startLive,
  stopLive,
  signal,
  sendTo,
  open,
  close,
  play,
  pause,
  seek,
  command,
  setReady,
  attach,
  detach,
  snapshot,
  canSubscribe,
  subscribe,
  unsubscribe,
  startTimers,
  stopTimers,
  withinRate,
  withinSignalRate,
  MAX_SIGNAL,
  SIGNALS,
  reset,
};
