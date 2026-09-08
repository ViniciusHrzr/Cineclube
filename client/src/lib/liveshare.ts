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
   tamanho de um clube, e por isso a alternativa (um servidor de mídia que
   recebe uma cópia e distribui) não está aqui — ela é infraestrutura, e este
   produto roda numa instância de 512 MB.

   ── quem fala primeiro ────────────────────────────────────────────────────
   O espectador. Isso é o contrário do que parece natural — quem tem a imagem
   deveria oferecê-la —, e é assim de propósito.

   Se o transmissor oferecesse, ele teria de saber para QUEM: leria a lista de
   pessoas na sala, notaria quem entrou, e teria de descobrir sozinho que a
   conexão de alguém morreu para refazê-la. Cada um desses é um jeito de a sala
   e a realidade discordarem, e o sintoma é sempre o mesmo: uma pessoa olhando
   para um retângulo preto enquanto o servidor jura que está tudo certo.

   Com o pedido vindo do outro lado, nada disso precisa existir. Quem quer
   imagem e não tem pede — ao entrar, ao recarregar a página, e de novo alguns
   segundos depois se ainda não chegou nada. O transmissor não mantém lista de
   ninguém: ele responde a quem pediu. A recuperação de falha é o mesmo caminho
   da conexão inicial, e um caminho que se usa toda noite não enferruja.

   ── os candidatos que chegam cedo demais ─────────────────────────────────
   Um navegador começa a mandar candidatos de rede assim que gera a oferta, e
   eles atravessam o servidor mais rápido do que a outra ponta leva para
   processar a descrição que os explica. Um candidato aplicado antes disso é um
   erro, e um candidato descartado é um caminho de rede a menos — que pode ser
   justamente o único que funcionaria. Então eles esperam numa fila por par,
   até haver descrição remota. Ver `flush`.
   ══════════════════════════════════════════════════════════════════════════ */

/** Enquanto não chega imagem, o pedido é refeito. Ver "quem fala primeiro". */
const WANT_RETRY_MS = 4000;

/* O que o navegador é instruído a priorizar ao codificar. `motion` diz "prefira
   manter o movimento fluido a manter cada pixel nítido", que é exatamente a
   troca certa para um filme e exatamente a errada para uma planilha — o padrão
   de uma captura de tela é o segundo. Sem isto, uma cena de ação vira uma
   sequência de fotos nítidas. */
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
  /** Capturar a tela e assumir a transmissão da sala. */
  start: () => Promise<void>;
  /** Largar. Fecha as conexões e apaga a sala. */
  stop: () => void;
};

type Peer = {
  pc: RTCPeerConnection;
  /* Candidatos que chegaram antes da descrição remota. Ver o cabeçalho. */
  queued: RTCIceCandidateInit[];
};

export function useLiveShare(screening: Screening, meId: string): LiveShare {
  const { state, sendSignal, onSignal, startLive, stopLive, fetchIce } = screening;
  const live = state.live;
  const hostId = live?.hostId ?? null;
  const host = hostId === meId;

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState(0);
  const [relayed, setRelayed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** As conexões vivas, por pessoa do outro lado. */
  const peerMap = useRef(new Map<string, Peer>());
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

  /* ── derrubar tudo ───────────────────────────────────────────────────────
     Uma função e não três, porque as três situações que a chamam querem
     exatamente a mesma coisa: a transmissão acabou, e o que existe por causa
     dela tem de sumir junto. Fechar a conexão é obrigatório e não cosmético —
     um RTCPeerConnection aberto continua mandando pacotes de manutenção e
     segurando a câmera do sistema operacional. */
  const drop = useCallback((keepLocal = false) => {
    for (const { pc } of peerMap.current.values()) pc.close();
    peerMap.current.clear();
    setPeers(0);
    if (!keepLocal) {
      for (const track of localRef.current?.getTracks() ?? []) track.stop();
      localRef.current = null;
    }
    setStream(null);
  }, []);

  /* ── uma conexão, dos dois lados ─────────────────────────────────────────
     O mesmo objeto serve para transmitir e para receber; o que muda é quem
     chama primeiro e quem põe faixa nele. Por isso isto não pergunta qual é o
     papel: quem chama já sabe. */
  const connect = useCallback(
    async (withId: string) => {
      const existing = peerMap.current.get(withId);
      if (existing) {
        existing.pc.close();
        peerMap.current.delete(withId);
      }

      const pc = new RTCPeerConnection(await ice());
      const peer: Peer = { pc, queued: [] };
      peerMap.current.set(withId, peer);

      pc.onicecandidate = e => {
        /* O nulo é o fim da lista, não um candidato. Mandá-lo seria o outro
           lado tentando aplicar "nada" como se fosse um caminho de rede. */
        if (e.candidate) void sendSignal(withId, 'ice', e.candidate.toJSON());
      };

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'connected') setError(null);
        /* Fechada ou falhada, a entrada some do mapa. Do lado de quem
           transmite isso derruba a contagem; do lado de quem recebe, o pedido
           periódico volta a valer e a conexão se refaz sozinha. */
        if (st === 'failed' || st === 'closed' || st === 'disconnected') {
          if (peerMap.current.get(withId)?.pc === pc) {
            pc.close();
            peerMap.current.delete(withId);
          }
        }
        setPeers(peerMap.current.size);
      };

      return peer;
    },
    [ice, sendSignal]
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

     Um único lugar para tudo o que chega pelo stream da sala, e é ele que faz
     o resto do arquivo não precisar de estado nenhum sobre a conversa: cada
     recado se explica pelo tipo e por quem mandou.
     ══════════════════════════════════════════════════════════════════════ */
  const heard = useCallback(
    async (from: string, kind: SignalKind, data: unknown) => {
      try {
        /* ── sou eu quem transmite ──────────────────────────────────────── */
        if (kind === 'want') {
          const local = localRef.current;
          if (!local) return; // Não estou transmitindo; o pedido não é comigo.
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
            if (incoming) setStream(incoming);
          };
          await peer.pc.setRemoteDescription(data as RTCSessionDescriptionInit);
          await flush(peer);
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          void sendSignal(from, 'answer', answer);
          return;
        }

        if (kind === 'ice') {
          const peer = peerMap.current.get(from);
          if (!peer) return;
          const candidate = data as RTCIceCandidateInit;
          /* Antes da descrição remota ele não pode ser aplicado — e não pode
             ser jogado fora. Espera. */
          if (!peer.pc.remoteDescription) peer.queued.push(candidate);
          else await peer.pc.addIceCandidate(candidate).catch(() => {});
        }
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [connect, flush, host, hostId, sendSignal]
  );

  /* A inscrição no stream da sala. O atendente muda de identidade a cada
     render — ele fecha sobre `hostId` —, então a inscrição o acompanha. */
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
        /* O áudio é o que separa "vejo o filme" de "assisto ao filme", e é a
           parte que mais varia entre navegadores: o Chrome e o Edge capturam o
           som de uma aba, e no Windows o do sistema inteiro. Pedido sempre; se
           o navegador não der, vem vídeo mudo em vez de erro. */
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

    /* O botão que o próprio navegador põe na tela ("Parar compartilhamento") é
       o caminho que mais gente vai usar, porque é o que ela já conhece. Ele não
       avisa este código de nada além disto. */
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
     O laço inteiro de quem assiste. Ele não sabe se a conexão vai falhar, se o
     transmissor acabou de trocar de tela ou se a página foi recarregada — e
     não precisa saber, porque a resposta é a mesma nos três casos. */
  useEffect(() => {
    if (!hostId || host) return;
    let alive = true;
    const ask = () => {
      if (!alive) return;
      /* Já chegou imagem: não há o que pedir. A checagem é do mapa e não do
         estado porque uma conexão que morreu some do mapa no mesmo instante,
         enquanto o `<video>` ainda segura o último quadro. */
      if (peerMap.current.size) return;
      void sendSignal(hostId, 'want');
    };
    ask();
    const id = window.setInterval(ask, WANT_RETRY_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [hostId, host, sendSignal]);

  /* ── quando o dono da tela muda ──────────────────────────────────────────
     Acabou, ou passou para outra pessoa. Nos dois casos o que existe aqui foi
     construído para o dono anterior e não tem mais para onde ir: a conexão
     aponta para uma máquina que parou de mandar quadros.

     Comparado com o valor anterior e não lido do estado, porque isto tem de
     disparar na TROCA e só nela. Um efeito que rodasse a cada render mataria a
     conexão que acabou de ser feita.

     A saída antecipada quando `host` é o ponto delicado: assumir a transmissão
     também muda o dono, e sem esta linha a sala confirmando "é você" chegaria
     logo depois de `start()` e derrubaria a captura que ele acabou de abrir. */
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

  return { role, phase, stream, peers, relayed, error, start, stop };
}
