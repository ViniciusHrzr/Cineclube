import { useCallback, useEffect, useRef, useState } from 'react';
import type { Screening, SignalKind } from '@/lib/screening';

/* ══════════════════════════════════════════════════════════════════════════
   A TELA DE ALGUÉM, NA TELA DE TODO MUNDO.

   O segundo modo da sessão, e o avesso do primeiro. No modo arquivo cada
   pessoa tem a própria cópia do filme e o que viaja é um relógio: por isso
   existem a posição derivada, a deriva, a tolerância, a almofada de buffer —
   toda a máquina de fazer quatro vídeos independentes fingirem ser um.

   Aqui não há o que fingir. Existe UM vídeo, saindo da placa de vídeo de quem
   transmite, e as outras pessoas recebem os mesmos quadros. Sincronia deixa de
   ser um problema e vira uma consequência. Quem controla é quem está com a
   tela — o play, o pause e o avanço são os do player DELE, e o clube vê isso
   acontecer com menos de um segundo de atraso.

   O preço é a subida de quem transmite. Numa malha, ele manda uma cópia do
   vídeo para cada pessoa: cinco espectadores a 2,5 Mbps são uns 12,5 Mbps
   saindo daquela máquina. É por isso que a malha só serve para uma sala do
   tamanho de um clube.

   ── quem fala primeiro ────────────────────────────────────────────────────
   O espectador. Isso é o contrário do que parece natural — quem tem a imagem
   deveria oferecê-la —, e é assim de propósito.

   Se o transmissor oferecesse, ele teria de saber para QUEM: leria a lista de
   pessoas na sala, notaria quem entrou, e teria de descobrir sozinho que a
   conexão de alguém morreu para refazê-la. Cada um desses é um jeito de a sala
   e a realidade discordarem.

   Com o pedido vindo do outro lado, nada disso precisa existir. Quem quer
   imagem e não tem pede. O transmissor não mantém lista de ninguém: responde a
   quem pediu.

   ══════════════════════════════════════════════════════════════════════════
   AS DUAS ARMADILHAS DESTE ARQUIVO

   As duas produzem o MESMO sintoma, e é o pior sintoma possível: a conexão
   fecha, o `<video>` recebe um stream, e o que toca é um retângulo preto e
   mudo. Para sempre, sem erro em lugar nenhum. Foi assim que a primeira versão
   deste arquivo saiu, e vale escrever por que.

   ── 1. o candidato que chega antes do dono ────────────────────────────────
   Um navegador cospe candidatos de rede assim que termina a própria descrição,
   e eles atravessam o servidor mais rápido do que o outro lado leva para
   montar a conexão dele. Quem recebe um candidato de um par que ainda não
   existe não tem onde guardá-lo.

   A primeira versão jogava fora. E jogar fora não é neutro: os primeiros
   candidatos são justamente os melhores — o endereço da rede local e o que o
   STUN acabou de descobrir. Perdidos eles, sobra tentar caminhos piores, e às
   vezes não sobra nenhum. Agora esperam em `early`, e são despejados no par no
   instante em que ele nasce.

   ── 2. o pedido repetido que derruba a resposta ───────────────────────────
   O espectador pede imagem e repete o pedido se nada chegar. O transmissor
   respondia a cada pedido montando uma conexão NOVA — e fechando a anterior.

   Numa rede lenta isso é uma armadilha que fecha sozinha: o pedido é repetido
   antes de a primeira oferta chegar, o transmissor derruba a conexão que
   acabou de oferecer, e a resposta do espectador chega para um objeto que já
   foi fechado. Os dois lados ficam achando que estão conectados a alguém. O
   espectador até recebe um stream — de uma conexão morta —, e o resultado é a
   tela preta e muda.

   Agora um pedido repetido para uma conexão que ainda está tentando é
   IGNORADO. Só se remonta o que morreu de verdade. E o espectador não repete
   por não ter par: repete por não ter par CONECTADO, dentro de um prazo que dá
   tempo de um aperto de mão inteiro acontecer.
   ══════════════════════════════════════════════════════════════════════════ */

/** De quanto em quanto o espectador reavalia se precisa pedir de novo. */
const TICK_MS = 2000;
/* Quanto tempo um aperto de mão tem para fechar antes de ser considerado
   perdido. Precisa caber a coleta de candidatos dos dois lados mais duas
   viagens pelo servidor; abaixo disso o remédio vira a doença — foi o que a
   armadilha 2 fazia com quatro segundos. */
const HANDSHAKE_MS = 12_000;

/* O que o navegador é instruído a priorizar ao codificar. `motion` diz "prefira
   manter o movimento fluido a manter cada pixel nítido", que é a troca certa
   para um filme e a errada para uma planilha — e planilha é o que o padrão de
   uma captura de tela assume. */
const HINT = 'motion';

export type LivePhase =
  /** Ninguém transmitindo. */
  | 'off'
  /** Este navegador está pedindo imagem e ainda não recebeu quadro nenhum. */
  | 'waiting'
  /** Recebendo, ou transmitindo com pelo menos uma pessoa conectada. */
  | 'live'
  /** Este navegador transmite e ninguém pediu imagem ainda. */
  | 'alone'
  | 'failed';

export type LiveShare = {
  role: 'off' | 'host' | 'viewer';
  phase: LivePhase;
  /** O que mostrar na tela: a captura local, ou o que chegou do transmissor. */
  stream: MediaStream | null;
  /** Quantas pessoas estão recebendo de mim. Só faz sentido transmitindo. */
  peers: number;
  /** Há relay configurado. Falso é uma promessa a menos que a tela pode fazer. */
  relayed: boolean;
  error: string | null;
  /* ── o estágio, em palavras ────────────────────────────────────────────
     Existe porque "não funcionou" tem várias causas com o mesmo desenho, e
     sem isto a única coisa que se pode dizer a quem está do outro lado é
     "está preto". Separa as três que importam: não achou caminho (rede),
     conectou e não veio quadro (DRM ou codec), e conectou e está tocando. */
  detail: string | null;
  /** A captura de quem transmite tem faixa de áudio. Falso é um filme mudo. */
  hasAudio: boolean;
  /** Capturar a tela e assumir a transmissão da sala. */
  start: () => Promise<void>;
  /** Largar. Fecha as conexões e apaga a sala. */
  stop: () => void;
};

type Peer = {
  pc: RTCPeerConnection;
  /** Candidatos que chegaram antes da descrição remota. */
  queued: RTCIceCandidateInit[];
  /** Quando o aperto de mão começou, para saber quando ele demorou demais. */
  since: number;
};

const DEAD = new Set(['failed', 'closed']);

export function useLiveShare(screening: Screening, meId: string): LiveShare {
  const { state, sendSignal, onSignal, startLive, stopLive, fetchIce } = screening;
  const live = state.live;
  const hostId = live?.hostId ?? null;
  const host = hostId === meId;

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState(0);
  const [relayed, setRelayed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [hasAudio, setHasAudio] = useState(false);

  /** As conexões vivas, por pessoa do outro lado. */
  const peerMap = useRef(new Map<string, Peer>());
  /* Candidatos de um par que ainda não existe. Ver a armadilha 1. */
  const early = useRef(new Map<string, RTCIceCandidateInit[]>());
  /** A captura desta máquina, quando este navegador é o que transmite. */
  const localRef = useRef<MediaStream | null>(null);
  /** Buscado uma vez e guardado: são endereços, não estado. */
  const iceRef = useRef<RTCConfiguration | null>(null);

  const ice = useCallback(async () => {
    if (iceRef.current) return iceRef.current;
    try {
      const got = await fetchIce();
      setRelayed(got.relayed);
      iceRef.current = { iceServers: got.iceServers };
    } catch {
      /* Sem resposta do servidor, um STUN público é melhor do que desistir:
         ele resolve a maioria das redes, e a alternativa é não tentar. */
      iceRef.current = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    }
    return iceRef.current;
  }, [fetchIce]);

  /* Buscado na montagem e não na primeira conexão. Parece detalhe e não é: era
     uma ida ao servidor NO MEIO do aperto de mão, somando ao relógio que o
     espectador está contando para decidir se repete o pedido. */
  useEffect(() => {
    void ice();
  }, [ice]);

  /** Fecha uma conexão e esquece o que era dela. */
  const forget = useCallback((withId: string) => {
    const held = peerMap.current.get(withId);
    if (!held) return;
    held.pc.close();
    peerMap.current.delete(withId);
    early.current.delete(withId);
    setPeers(peerMap.current.size);
  }, []);

  /* ── derrubar tudo ───────────────────────────────────────────────────────
     Fechar a conexão é obrigatório e não cosmético: um RTCPeerConnection
     aberto continua mandando pacotes de manutenção, e uma captura de tela viva
     mantém a luz de "compartilhando" acesa no sistema operacional. */
  const drop = useCallback(() => {
    for (const { pc } of peerMap.current.values()) pc.close();
    peerMap.current.clear();
    early.current.clear();
    setPeers(0);
    for (const track of localRef.current?.getTracks() ?? []) track.stop();
    localRef.current = null;
    setStream(null);
    setDetail(null);
    setHasAudio(false);
  }, []);

  /* ── uma conexão, dos dois lados ─────────────────────────────────────────
     O mesmo objeto serve para transmitir e para receber; o que muda é quem
     chama primeiro e quem põe faixa nele. */
  const connect = useCallback(
    async (withId: string) => {
      forget(withId);

      const pc = new RTCPeerConnection(await ice());
      const peer: Peer = { pc, queued: early.current.get(withId) ?? [], since: Date.now() };
      early.current.delete(withId);
      peerMap.current.set(withId, peer);

      pc.onicecandidate = e => {
        /* O nulo é o fim da lista, não um candidato. Mandá-lo seria o outro
           lado tentando aplicar "nada" como se fosse um caminho de rede. */
        if (e.candidate) void sendSignal(withId, 'ice', e.candidate.toJSON());
      };

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (peerMap.current.get(withId)?.pc !== pc) return;

        if (st === 'connected') {
          setError(null);
          setDetail('conectado');
        } else if (st === 'connecting') {
          setDetail('procurando um caminho pela rede…');
        } else if (st === 'disconnected') {
          /* Estado passageiro e NÃO fatal: um pacote perdido derruba a conexão
             para cá e ela volta sozinha segundos depois. Derrubar o par aqui
             era refazer o aperto de mão a cada soluço de rede. */
          setDetail('a rede oscilou; tentando manter');
        } else if (DEAD.has(st)) {
          setDetail(st === 'failed' ? 'não achei caminho até essa máquina' : null);
          forget(withId);
        }
        setPeers(peerMap.current.size);
      };

      return peer;
    },
    [ice, sendSignal, forget]
  );

  /** Os candidatos que esperavam a descrição remota. */
  const flush = useCallback(async (peer: Peer) => {
    const held = peer.queued.splice(0);
    for (const candidate of held) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch {
        /* Um candidato recusado é um caminho a menos, não uma conexão perdida:
           o navegador manda vários e basta um servir. */
      }
    }
  }, []);

  /* ══════════════════════════════════════════════════════════════════════
     O ATENDENTE.
     ══════════════════════════════════════════════════════════════════════ */
  const heard = useCallback(
    async (from: string, kind: SignalKind, data: unknown) => {
      try {
        /* ── sou eu quem transmite ──────────────────────────────────────── */
        if (kind === 'want') {
          const local = localRef.current;
          if (!local) return; // Não estou transmitindo; o pedido não é comigo.

          /* A armadilha 2. Um pedido repetido enquanto a conexão anterior
             ainda está tentando não é um pedido novo — é a mesma pessoa
             perguntando de novo porque ainda não viu resposta. Remontar aqui
             fecharia o par para o qual a resposta dela está a caminho. */
          const held = peerMap.current.get(from);
          if (held && !DEAD.has(held.pc.connectionState)) return;

          const peer = await connect(from);
          for (const track of local.getTracks()) peer.pc.addTrack(track, local);
          const offer = await peer.pc.createOffer();
          await peer.pc.setLocalDescription(offer);
          void sendSignal(from, 'offer', offer);
          setPeers(peerMap.current.size);
          return;
        }

        if (kind === 'answer') {
          const peer = peerMap.current.get(from);
          if (!peer) return;
          /* Uma resposta que chega para um par que já passou desse ponto é de
             uma negociação anterior. Aplicá-la derruba a que está de pé. */
          if (peer.pc.signalingState !== 'have-local-offer') return;
          await peer.pc.setRemoteDescription(data as RTCSessionDescriptionInit);
          await flush(peer);
          return;
        }

        /* ── estou recebendo ────────────────────────────────────────────── */
        if (kind === 'offer') {
          /* Só de quem a sala diz que está transmitindo. Sem esta linha,
             qualquer membro poderia empurrar vídeo para a tela de outro. */
          if (from !== hostId || host) return;
          const peer = await connect(from);
          peer.pc.ontrack = e => {
            const [incoming] = e.streams;
            if (incoming) {
              setStream(incoming);
              setDetail('recebendo');
            }
          };
          await peer.pc.setRemoteDescription(data as RTCSessionDescriptionInit);
          await flush(peer);
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          void sendSignal(from, 'answer', answer);
          return;
        }

        if (kind === 'ice') {
          const candidate = data as RTCIceCandidateInit;
          const peer = peerMap.current.get(from);
          /* A armadilha 1: o par ainda não existe. Guardado por remetente até
             ele nascer, porque os primeiros candidatos são os melhores. */
          if (!peer) {
            const fila = early.current.get(from) ?? [];
            fila.push(candidate);
            early.current.set(from, fila);
            return;
          }
          if (!peer.pc.remoteDescription) peer.queued.push(candidate);
          else await peer.pc.addIceCandidate(candidate).catch(() => {});
        }
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [connect, flush, host, hostId, sendSignal]
  );

  useEffect(() => onSignal((from, kind, data) => void heard(from, kind, data)), [onSignal, heard]);

  /* ── capturar e assumir ──────────────────────────────────────────────────
     A ordem importa. A captura vem antes do pedido à sala porque ela é a que
     pode ser recusada por uma pessoa: o navegador abre o seletor de janelas, e
     fechá-lo é um "não" legítimo que não deve deixar a sala anunciando uma
     transmissão que nunca começou. */
  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Este navegador não sabe compartilhar tela. Chrome ou Edge, no computador.');
      return;
    }
    let capture: MediaStream;
    try {
      capture = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 60 } },
        /* O áudio é o que separa "vejo o filme" de "assisto ao filme". Pedido
           sempre; o navegador dá ou não dá, e `hasAudio` conta qual foi. */
        audio: true,
      });
    } catch (e) {
      /* Fechar o seletor de janelas cai aqui, e não é erro nenhum — é a pessoa
         desistindo. Só o que não for isso vira mensagem. */
      const name = (e as Error).name;
      if (name !== 'NotAllowedError' && name !== 'AbortError') {
        setError('Não foi possível capturar a tela: ' + (e as Error).message);
      }
      return;
    }

    for (const track of capture.getVideoTracks()) track.contentHint = HINT;
    localRef.current = capture;
    setStream(capture);
    /* Uma captura sem faixa de áudio é um filme mudo para o clube inteiro, e
       quem transmite não tem como perceber — o som continua saindo das caixas
       DELE. Por isso isto é medido e dito na tela. */
    setHasAudio(capture.getAudioTracks().length > 0);

    /* O botão que o próprio navegador põe na tela ("Parar compartilhamento") é
       o caminho que mais gente vai usar, porque é o que ela já conhece. */
    for (const track of capture.getVideoTracks()) {
      track.addEventListener('ended', () => {
        drop();
        void stopLive();
      });
    }

    if (!(await startLive())) {
      /* A vaga era de outra pessoa. A captura morre aqui — deixá-la aberta
         seria a luz de "compartilhando" acesa no sistema por nada. */
      drop();
    }
  }, [drop, startLive, stopLive]);

  const stop = useCallback(() => {
    drop();
    void stopLive();
  }, [drop, stopLive]);

  /* ── pedir imagem, e continuar pedindo ───────────────────────────────────
     O laço inteiro de quem assiste, e ele pergunta a coisa certa: não "tenho
     um par?", mas "tenho um par CONECTADO?". A diferença é a armadilha 2 —
     um par existir só quer dizer que um objeto foi construído. */
  useEffect(() => {
    if (!hostId || host) return;
    let alive = true;

    const tick = () => {
      if (!alive) return;
      const peer = peerMap.current.get(hostId);

      if (peer) {
        const st = peer.pc.connectionState;
        if (st === 'connected') return;
        /* Ainda dentro do prazo do aperto de mão: esperar é o certo. Repetir
           aqui é o que derrubava a resposta que estava a caminho. */
        if (!DEAD.has(st) && Date.now() - peer.since < HANDSHAKE_MS) return;
        /* Passou do prazo, ou morreu. Este par não vai vingar; fora ele antes
           de pedir de novo, senão o transmissor ignora o pedido novo por já
           haver um par deste lado. */
        forget(hostId);
        setStream(null);
      }

      setDetail('pedindo a imagem…');
      void sendSignal(hostId, 'want');
    };

    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [hostId, host, sendSignal, forget]);

  /* ── quando o dono da tela muda ──────────────────────────────────────────
     Acabou, ou passou para outra pessoa. Nos dois casos o que existe aqui foi
     construído para o dono anterior e não tem mais para onde ir.

     Comparado com o valor anterior e não lido do estado, porque isto tem de
     disparar na TROCA e só nela. A saída antecipada quando `host` é o ponto
     delicado: assumir a transmissão também muda o dono, e sem ela a sala
     confirmando "é você" derrubaria a captura que `start()` acabou de abrir. */
  const lastHost = useRef<string | null>(null);
  useEffect(() => {
    if (lastHost.current === hostId) return;
    lastHost.current = hostId;
    if (host) return;
    drop();
  }, [hostId, host, drop]);

  /* Desmontar a tela derruba tudo. Sem isto, sair da aba da Sessão deixaria as
     conexões abertas e a captura de tela viva atrás dela. */
  useEffect(() => () => drop(), [drop]);

  const role = !hostId ? 'off' : host ? 'host' : 'viewer';
  const phase: LivePhase = !hostId
    ? 'off'
    : error
      ? 'failed'
      : host
        ? peers > 0
          ? 'live'
          : 'alone'
        : stream
          ? 'live'
          : 'waiting';

  return { role, phase, stream, peers, relayed, error, detail, hasAudio, start, stop };
}
