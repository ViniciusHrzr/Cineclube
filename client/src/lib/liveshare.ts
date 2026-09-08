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

/* ── por que a imagem saía lavada ─────────────────────────────────────────
   O WebRTC trata conteúdo de tela como apresentação de slides: o teto de banda
   que ele assume sozinho para uma captura fica na casa de 2 Mbps, que é
   generoso para um documento parado e é lama para um filme em movimento. O
   codificador então faz a única coisa que pode com o que lhe deram — joga
   resolução fora — e o resultado é exatamente o que se viu.

   Oito megabits é folgado para 1080p30 de conteúdo real, e é um TETO, não uma
   meta: quando a rede não sustenta, o controle de congestionamento desce
   sozinho e a sessão continua. O que o teto muda é que a decisão passa a ser
   da rede, e não de um palpite feito antes de a rede existir. */
const VIDEO_BITRATE = 8_000_000;
/* Opus com música. O padrão de uma chamada fica perto de 32 kbps porque o
   assunto é voz; 192 kbps em estéreo é o que faz trilha sonora soar como
   trilha sonora. */
const AUDIO_BITRATE = 192_000;

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
  /** O que foi escolhido no seletor: 'monitor', 'window' ou 'browser'. */
  surface: string | null;
  /* ── de onde sai o som que o clube ouve ─────────────────────────────────
     Entradas de áudio desta máquina, para quando o mix do sistema não serve.
     Vazia até alguém pedir: listar exige permissão, e pedir microfone a quem
     nunca vai trocar de fonte é assustar por nada. */
  audioSources: MediaDeviceInfo[];
  /** `null` é o som que veio junto com a captura da tela. */
  audioSourceId: string | null;
  /** Pergunta ao sistema quais entradas existem. Pede permissão uma vez. */
  listAudio: () => Promise<void>;
  /** Troca o som em voo, sem derrubar ninguém. */
  pickAudio: (deviceId: string | null) => Promise<void>;
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

/* ── o que o codificador recebe de ordem ──────────────────────────────────
   Chamado depois de a faixa entrar na conexão, e é o que separa uma imagem de
   filme de um borrão. `degradationPreference` é a segunda metade: sob aperto,
   `balanced` reparte a perda entre nitidez e fluidez em vez de despencar a
   resolução, que é o comportamento padrão para conteúdo de tela. */
async function tune(sender: RTCRtpSender) {
  const kind = sender.track?.kind;
  try {
    const params = sender.getParameters();
    /* Uma conexão recém-criada às vezes ainda não tem codificação nenhuma
       listada; escrever por cima de um array vazio é um erro do navegador. */
    if (!params.encodings?.length) params.encodings = [{}];
    if (kind === 'video') {
      params.degradationPreference = 'balanced';
      params.encodings[0].maxBitrate = VIDEO_BITRATE;
      params.encodings[0].maxFramerate = 30;
      /* Explícito porque o padrão para tela é reduzir: a captura já vem no
         tamanho certo, e encolhê-la é jogar fora o que se quis mostrar. */
      params.encodings[0].scaleResolutionDownBy = 1;
    } else {
      params.encodings[0].maxBitrate = AUDIO_BITRATE;
    }
    await sender.setParameters(params);
  } catch {
    /* Um navegador que recusa este ajuste continua transmitindo com o padrão
       dele. Pior imagem não é motivo para não haver imagem. */
  }
}

/* ── o estéreo, que só existe se for pedido no SDP ────────────────────────
   O Opus nasce mono numa chamada, porque o assunto de uma chamada é voz. Não
   há API para mudar isso: a única forma é escrever no próprio SDP, na linha
   que descreve o codec, antes de ele virar a descrição local.

   Editar SDP é sempre suspeito e este é um dos poucos casos em que é a prática
   corrente — não se inventa nada, só se preenche parâmetros que o padrão do
   Opus define. Se a linha não estiver lá, nada é feito: um SDP meio editado é
   pior do que um SDP intocado. */
function inStereo(sdp: string) {
  const rtpmap = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!rtpmap) return sdp;
  const pt = rtpmap[1];
  const extra = `stereo=1;sprop-stereo=1;maxaveragebitrate=${AUDIO_BITRATE}`;
  const fmtp = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  if (fmtp.test(sdp)) {
    return sdp.replace(fmtp, (_all, params: string) =>
      params.includes('stereo=') ? `a=fmtp:${pt} ${params}` : `a=fmtp:${pt} ${params};${extra}`
    );
  }
  return sdp.replace(rtpmap[0], `${rtpmap[0]}\r\na=fmtp:${pt} ${extra}`);
}

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
  const [surface, setSurface] = useState<string | null>(null);
  const [audioSources, setAudioSources] = useState<MediaDeviceInfo[]>([]);
  const [audioSourceId, setAudioSourceId] = useState<string | null>(null);
  /* A faixa de áudio que veio junto com a captura da tela. Guardada mesmo
     enquanto outra está no ar, porque voltar para ela é uma opção — e pedir a
     captura de novo só para desfazer uma troca custaria o seletor de janelas
     inteiro e a transmissão junto. */
  const captureAudio = useRef<MediaStreamTrack | null>(null);
  /** A faixa vinda de uma entrada escolhida à mão, quando há uma. */
  const pickedAudio = useRef<MediaStreamTrack | null>(null);

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
    /* A faixa escolhida à mão não pertence à captura, então ela não morre
       junto com o stream da tela — precisa ser fechada aqui, ou o indicador de
       microfone em uso fica aceso depois de a transmissão acabar. */
    pickedAudio.current?.stop();
    pickedAudio.current = null;
    captureAudio.current = null;
    setStream(null);
    setDetail(null);
    setHasAudio(false);
    setSurface(null);
    setAudioSourceId(null);
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
          for (const track of local.getTracks()) await tune(peer.pc.addTrack(track, local));
          const offer = await peer.pc.createOffer();
          /* O estéreo é pedido aqui, na oferta, porque é ela que declara o que
             este lado vai mandar. Depois de `setLocalDescription` não há mais
             o que negociar. */
          const dito = { type: offer.type, sdp: inStereo(offer.sdp ?? '') };
          await peer.pc.setLocalDescription(dito);
          void sendSignal(from, 'offer', dito);
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

          /* ── uma oferta pode ser a primeira ou a segunda ─────────────────
             A segunda acontece quando quem transmite troca a fonte de áudio
             numa conexão que não tinha faixa de som: não há o que substituir,
             então uma faixa é acrescentada e isso exige negociar de novo.

             Montar um par novo aqui derrubaria a imagem que já está na tela
             para receber a mesma imagem de volta. Um par vivo e em repouso
             recebe a oferta e responde; só o que morreu é remontado. */
          const vivo = peerMap.current.get(from);
          const reaproveita = vivo && !DEAD.has(vivo.pc.connectionState);
          if (reaproveita && vivo.pc.signalingState !== 'stable') {
            /* Ofertas cruzadas. Este lado nunca oferece, então isto é uma
               oferta chegando em cima de outra ainda em curso: a primeira
               termina, e o laço de pedido refaz o par se não terminar. */
            return;
          }

          const peer = reaproveita ? vivo : await connect(from);
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
          /* Também na resposta: ela é a declaração de que ESTE lado sabe
             receber dois canais. Sem isso, o outro lado manda mono por
             educação. */
          const dito = { type: answer.type, sdp: inStereo(answer.sdp ?? '') };
          await peer.pc.setLocalDescription(dito);
          void sendSignal(from, 'answer', dito);
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
        video: {
          /* Pedido explícito, porque o padrão de uma captura de tela é o que o
             navegador achar barato. 1080p é o que um filme quer e o que a
             malha aguenta; o `ideal` deixa uma tela menor ser ela mesma em vez
             de ser esticada até aqui. */
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 60 },
          /* Abre o seletor já na aba de telas inteiras. É preferência e não
             regra — a pessoa continua podendo escolher uma janela —, mas o
             caminho que leva som é o que aparece primeiro. */
          displaySurface: 'monitor',
        },
        /* ── o áudio, e por que ele é pedido assim ─────────────────────────
           Sem tratamento nenhum. As três primeiras são o processamento de VOZ
           que um navegador liga por padrão — cancelar eco, suprimir ruído,
           nivelar ganho —, e as três destroem música: o supressor de ruído come
           a cauda de um acorde, e o ganho automático abaixa o volume toda vez
           que a trilha cresce. Numa chamada elas são o produto; num filme são
           um estrago. */
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
          sampleRate: 48_000,
        },
        /* ── as dicas que só o Chrome entende ──────────────────────────────
           Fora do tipo padrão porque não estão no `lib.dom` — e valem o
           desconforto, porque decidem o que a pessoa vê no seletor de janelas.

           `systemAudio: include` e `displaySurface: monitor` empurram a escolha
           para TELA INTEIRA, que é o único modo em que o Chrome oferece o som
           do sistema. É o que faz um VLC, um player de TV ou qualquer programa
           fora do navegador ser ouvido pelo clube — compartilhar uma JANELA não
           carrega áudio nenhum, em nenhuma plataforma, e nunca vai carregar.

           `selfBrowserSurface: exclude` tira esta própria aba da lista, que
           escolhida gera o túnel de espelhos infinito. `surfaceSwitching`
           deixa trocar de tela sem derrubar a transmissão. */
        ...({
          systemAudio: 'include',
          monitorTypeSurfaces: 'include',
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
        } as object),
      } as DisplayMediaStreamOptions);
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
    /* Guardada para poder voltar a ela depois de uma troca de fonte, sem
       precisar reabrir o seletor de janelas. */
    captureAudio.current = capture.getAudioTracks()[0] ?? null;
    setAudioSourceId(null);
    /* E o QUE foi escolhido, porque é isso que explica o mudo. Uma janela não
       leva som em navegador nenhum: sabendo qual superfície é, a tela para de
       dizer "sem áudio" e passa a dizer o que fazer a respeito. */
    setSurface(
      (capture.getVideoTracks()[0]?.getSettings() as { displaySurface?: string })?.displaySurface ??
        null
    );

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

  /* ══════════════════════════════════════════════════════════════════════
     DE ONDE SAI O SOM, E POR QUE ISTO PRECISA EXISTIR.

     O clube assiste junto e conversa no Discord ao mesmo tempo. Quando quem
     transmite manda "o áudio do sistema", o sistema inclui o Discord: as vozes
     de todo mundo voltam pela transmissão com quase um segundo de atraso, e
     quem está nas duas coisas se ouve falando duas vezes.

     Nenhuma configuração de navegador conserta isso. `getDisplayMedia` recebe
     o mix já pronto do sistema operacional — não existe API, em navegador
     nenhum, para tirar um aplicativo de dentro dele. O que existe é escolher
     OUTRA fonte, e é isso que estas duas funções fazem.

     Dois caminhos limpos, e os dois passam por aqui:

     · **Compartilhar a aba** em que o filme está tocando. O áudio de aba é só
       daquela aba, e o Discord fica de fora por construção. É a resposta
       quando o filme está no navegador, e não precisa de nada disto.

     · **Uma entrada de áudio dedicada**, quando o filme está num VLC ou num
       programa qualquer. Manda-se o som do player para um cabo virtual
       (VB-Cable e afins), escolhe-se esse cabo aqui, e o que sai é só o filme.
       O Discord continua tocando nas caixas de quem transmite e não entra na
       transmissão, porque nunca passou por essa entrada.
     ══════════════════════════════════════════════════════════════════════ */

  const listAudio = useCallback(async () => {
    try {
      /* A permissão vem primeiro porque sem ela `enumerateDevices` devolve
         entradas sem NOME — uma lista de identificadores opacos, onde escolher
         "o cabo virtual" é impossível. O stream é fechado no mesmo instante:
         o que se queria dele era o direito de ler os rótulos. */
      const permissao = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of permissao.getTracks()) t.stop();
      const todos = await navigator.mediaDevices.enumerateDevices();
      setAudioSources(todos.filter(d => d.kind === 'audioinput' && d.deviceId));
    } catch (e) {
      setError('Não consegui listar as entradas de áudio: ' + (e as Error).message);
    }
  }, []);

  const pickAudio = useCallback(
    async (deviceId: string | null) => {
      setError(null);
      let faixa: MediaStreamTrack | null = null;

      if (deviceId === null) {
        faixa = captureAudio.current;
      } else {
        try {
          const som = await navigator.mediaDevices.getUserMedia({
            /* O mesmo pedido sem processamento da captura, pela mesma razão: o
               que vem por aqui é música, e o tratamento de voz a estraga. */
            audio: {
              deviceId: { exact: deviceId },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              channelCount: 2,
              sampleRate: 48_000,
            },
          });
          faixa = som.getAudioTracks()[0] ?? null;
        } catch (e) {
          setError('Não consegui abrir essa entrada: ' + (e as Error).message);
          return;
        }
      }

      /* A faixa anterior escolhida à mão morre aqui. A da captura não: ela
         pertence ao stream da tela e é fechada junto com ele. */
      if (pickedAudio.current && pickedAudio.current !== faixa) {
        pickedAudio.current.stop();
        pickedAudio.current = null;
      }
      if (deviceId !== null && faixa) {
        /* `music` desliga as suposições que o codificador faz sobre voz. */
        faixa.contentHint = 'music';
        pickedAudio.current = faixa;
      }

      setAudioSourceId(deviceId);
      setHasAudio(Boolean(faixa));

      /* ── e agora, em voo ────────────────────────────────────────────────
         `replaceTrack` troca o que está saindo sem renegociar nada: ninguém
         perde a imagem, ninguém reconecta, o filme não pisca. É a razão de
         esta troca ser um botão e não um "pare e comece de novo".

         Quem não tem faixa de áudio nenhuma — uma captura de janela que veio
         muda — é o caso que exige negociar: não há o que substituir, então a
         faixa é acrescentada e uma oferta nova é mandada. */
      for (const [withId, peer] of peerMap.current) {
        const sender = peer.pc.getSenders().find(s => s.track?.kind === 'audio');
        if (sender) {
          await sender.replaceTrack(faixa).catch(() => {});
          if (faixa) await tune(sender);
          continue;
        }
        if (!faixa || !localRef.current) continue;
        await tune(peer.pc.addTrack(faixa, localRef.current));
        try {
          const offer = await peer.pc.createOffer();
          const dito = { type: offer.type, sdp: inStereo(offer.sdp ?? '') };
          await peer.pc.setLocalDescription(dito);
          void sendSignal(withId, 'offer', dito);
        } catch {
          /* A conexão morreu no meio da troca. O laço de pedido do outro lado
             refaz esse par sozinho. */
        }
      }
    },
    [sendSignal]
  );

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

  return {
    role,
    phase,
    stream,
    peers,
    relayed,
    error,
    detail,
    hasAudio,
    surface,
    audioSources,
    audioSourceId,
    listAudio,
    pickAudio,
    start,
    stop,
  };
}
