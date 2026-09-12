import { useCallback, useEffect, useRef, useState } from 'react';
import type { Screening, SignalKind } from '@/lib/screening';
import { inShell } from '@/lib/shell';

/* ══════════════════════════════════════════════════════════════════════════
   A TELA DE ALGUÉM, NA TELA DE TODO MUNDO — o segundo modo da sessão, e o
   avesso do primeiro. No modo arquivo cada pessoa tem a própria cópia e o que
   viaja é um relógio; aqui existe UM vídeo, e sincronia deixa de ser um
   problema e vira consequência.

   O preço é a subida de quem transmite: numa malha ele manda uma cópia para
   cada pessoa, e cinco espectadores a 2,5 Mbps são uns 12,5 Mbps saindo daquela
   máquina. Por isso a malha só serve para uma sala do tamanho de um clube.

   ── quem fala primeiro é o ESPECTADOR ─────────────────────────────────────
   O contrário do que parece natural, e de propósito. Se o transmissor
   oferecesse, ele teria de saber para QUEM: ler a lista da sala, notar quem
   entrou, descobrir sozinho que a conexão de alguém morreu. Cada um desses é um
   jeito de a sala e a realidade discordarem. Com o pedido vindo do outro lado,
   o transmissor não mantém lista de ninguém — responde a quem pediu.

   ══════════════════════════════════════════════════════════════════════════
   AS DUAS ARMADILHAS, e as duas dão o MESMO sintoma: a conexão fecha, o
   `<video>` recebe um stream, e o que toca é um retângulo preto e mudo. Para
   sempre, sem erro em lugar nenhum.

   ── 1. o candidato que chega antes do dono ────────────────────────────────
   Candidatos de rede atravessam o servidor mais rápido do que o outro lado leva
   para montar a conexão dele, e quem recebe um candidato de um par que ainda
   não existe não tem onde guardá-lo. Jogar fora não é neutro: os primeiros são
   justamente os melhores — o endereço da rede local e o que o STUN acabou de
   descobrir. Agora esperam em `early`.

   ── 2. o pedido repetido que derruba a resposta ───────────────────────────
   O espectador repete o pedido se nada chegar, e o transmissor respondia a cada
   um montando conexão NOVA e fechando a anterior. Numa rede lenta a armadilha
   fecha sozinha: a resposta do espectador chega para um objeto já fechado, e os
   dois lados ficam achando que estão conectados.

   Agora um pedido repetido para uma conexão que ainda está tentando é IGNORADO,
   e o espectador repete por não ter par CONECTADO — não por não ter par.
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

/* O WebRTC trata conteúdo de tela como apresentação de slides: o teto que ele
   assume sozinho fica na casa de 2 Mbps, generoso para um documento parado e
   lama para um filme em movimento. O codificador então joga resolução fora.

   Oito megabits é um TETO e não uma meta: quando a rede não sustenta, o
   controle de congestionamento desce sozinho. O que o teto muda é que a decisão
   passa a ser da rede, e não de um palpite feito antes de a rede existir. */
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

/* O Opus nasce mono numa chamada, porque o assunto de uma chamada é voz, e não
   há API para mudar isso: a única forma é escrever no próprio SDP antes de ele
   virar a descrição local. Editar SDP é sempre suspeito e este é um dos poucos
   casos em que é a prática corrente — não se inventa nada, só se preenchem
   parâmetros que o padrão do Opus define. Se a linha não estiver lá, nada é
   feito: um SDP meio editado é pior do que um intocado. */
/* O WebRTC não sabe quanta banda existe entre duas máquinas, então começa baixo
   e sobe medindo. Certo para uma chamada, errado para um filme: a sessão começa
   numa lama que vai clareando por meio minuto, bem quando o clube está olhando
   para a tela pela primeira vez.

   `x-google-start-bitrate` é onde o Chrome deixa dizer por onde COMEÇAR. Três
   megabits é imagem assistível no primeiro quadro e um chute conservador perto
   do teto de oito — se a rede não aguentar, ela desce em segundos, que é a
   direção barata do erro. Como o estéreo, só existe escrito no SDP. */
const START_BITRATE_KBPS = 3000;

function withStartBitrate(sdp: string) {
  /* Todo codec de vídeo, e não só o primeiro: o navegador oferece VP8, VP9,
     H.264 e AV1, e QUAL deles será usado quem decide é o outro lado. Ajustar
     um só é ajustar o que talvez não seja escolhido. */
  const codecs = [...sdp.matchAll(/a=rtpmap:(\d+) (?:VP8|VP9|H264|AV1)\/90000/gi)];
  let out = sdp;
  for (const achado of codecs) {
    const pt = achado[1];
    const param = `x-google-start-bitrate=${START_BITRATE_KBPS}`;
    const fmtp = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
    /* Emendado na linha que já existe quando ela existe. Uma SEGUNDA linha
       `a=fmtp:` para o mesmo formato é SDP inválido — o H.264 sempre traz a
       dele, com o perfil dentro —, e um SDP inválido não é uma qualidade pior,
       é uma conexão que não abre. */
    if (fmtp.test(out)) {
      out = out.replace(fmtp, (_all, params: string) =>
        params.includes('x-google-start-bitrate') ? `a=fmtp:${pt} ${params}` : `a=fmtp:${pt} ${params};${param}`
      );
    } else {
      out = out.replace(achado[0], `${achado[0]}\r\na=fmtp:${pt} ${param}`);
    }
  }
  return out;
}

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
          const dito = { type: offer.type, sdp: withStartBitrate(inStereo(offer.sdp ?? '')) };
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

          /* Uma oferta pode ser a primeira ou a SEGUNDA — a segunda acontece
             quando quem transmite troca a fonte de áudio numa conexão sem faixa
             de som, o que exige negociar de novo. Montar um par novo aqui
             derrubaria a imagem que já está na tela para receber a mesma imagem
             de volta: um par vivo recebe a oferta e responde. */
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
      /* Duas ausências, duas frases. O WebView de um aplicativo não tem
         `getDisplayMedia` e não vai ter: capturar a tela no Android é permissão
         de sistema e código nativo, não coisa que uma página peça. Mandar quem
         está no telefone "usar o Chrome no computador" seria uma instrução que
         não descreve o que está acontecendo. */
      setError(
        inShell()
          ? 'Transmitir a tela é do computador: o aplicativo não tem essa porta. Aqui dá para assistir o que outra pessoa transmitir.'
          : 'Este navegador não sabe compartilhar tela. Chrome ou Edge, no computador.'
      );
      return;
    }
    let capture: MediaStream;
    try {
      capture = await navigator.mediaDevices.getDisplayMedia({
        video: {
          /* ── um teto, e nunca um alvo ──────────────────────────────────
             Era `ideal: 1920 × 1080`, e num monitor que não é 16:9 isso CORTA:
             uma captura de tela não é uma câmera, e o Chrome atende uma
             proporção pedida recortando a tela até ela caber — some a barra de
             tarefas, some o rodapé do que a pessoa quis mostrar.

             `max` nos dois lados diz a única coisa que este produto quer dizer:
             não passe disto, porque a malha não aguenta e o filme não precisa.
             Sem alvo nenhum, a proporção continua sendo a do monitor, e uma
             tela menor continua sendo ela mesma em vez de ser esticada. */
          width: { max: 1920 },
          height: { max: 1080 },
          frameRate: { ideal: 30, max: 60 },
          /* Abre o seletor já na aba de telas inteiras. É preferência e não
             regra — a pessoa continua podendo escolher uma janela —, mas o
             caminho que leva som é o que aparece primeiro. */
          displaySurface: 'monitor',
        },
        /* Sem tratamento nenhum. As três primeiras são o processamento de VOZ
           que um navegador liga por padrão, e as três destroem música: o
           supressor de ruído come a cauda de um acorde, e o ganho automático
           abaixa o volume toda vez que a trilha cresce. */
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
          sampleRate: 48_000,
        },
        /* ── as dicas que só o Chrome entende ──────────────────────────────
           Fora do tipo padrão porque não estão no `lib.dom`, e valem o
           desconforto porque decidem o que a pessoa vê no seletor de janelas.

           `systemAudio: include` e `displaySurface: monitor` empurram para TELA
           INTEIRA, o único modo em que o Chrome oferece o som do sistema — é o
           que faz um VLC ser ouvido pelo clube. Compartilhar uma JANELA não
           carrega áudio nenhum, em plataforma nenhuma.

           `selfBrowserSurface: exclude` tira esta aba da lista, que escolhida
           gera o túnel de espelhos. `surfaceSwitching` deixa trocar de tela sem
           derrubar a transmissão. */
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
     DE ONDE SAI O SOM.

     O clube conversa no Discord enquanto assiste. Quando quem transmite manda
     "o áudio do sistema", o sistema inclui o Discord: as vozes voltam pela
     transmissão com quase um segundo de atraso, e quem está nas duas coisas se
     ouve falando duas vezes.

     Nenhuma configuração de navegador conserta isso — `getDisplayMedia` recebe
     o mix já pronto do sistema operacional. O que existe é escolher OUTRA
     fonte, e são dois caminhos limpos:

     · **Compartilhar a aba** em que o filme toca: o áudio de aba é só daquela
       aba, e o Discord fica de fora por construção.
     · **Uma entrada de áudio dedicada**, quando o filme está num VLC: manda-se
       o som do player para um cabo virtual, escolhe-se esse cabo aqui, e o que
       sai é só o filme.
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
      /* O Windows publica cada entrada três vezes: a real, uma sob o apelido
         `default` e outra sob `communications`, todas com o mesmo nome e um
         prefixo colado na frente. Numa lista de quatro linhas em que três dizem
         a mesma coisa, escolher deixa de ser escolher. */
      setAudioSources(
        todos.filter(
          d =>
            d.kind === 'audioinput' &&
            d.deviceId &&
            d.deviceId !== 'default' &&
            d.deviceId !== 'communications'
        )
      );
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

      /* `replaceTrack` troca o que está saindo sem renegociar nada: ninguém
         perde a imagem, o filme não pisca. É a razão de esta troca ser um botão
         e não um "pare e comece de novo".

         Quem não tem faixa de áudio nenhuma — uma captura de janela que veio
         muda — é o caso que exige negociar. */
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
          const dito = { type: offer.type, sdp: withStartBitrate(inStereo(offer.sdp ?? '')) };
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
