import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Blank, Fault, Key, Poster, Reel, SearchField, TrailerKey } from '@/components/bits';
import { SyncedVideo } from '@/components/SyncedVideo';
import { LiveVideo } from '@/components/LiveVideo';
import { WatchOn } from '@/components/film';
import { useWorld } from '@/lib/world';
import {
  api,
  fmt,
  initialsOf,
  reelColor,
  runtimeOf,
  seriesApi,
  type Episode,
  type Movie,
  type QueuedShow,
  type SeasonDetail,
  type SeriesItem,
  type ShowDetail,
  type WatchItem,
} from '@/lib/api';
import { episodeTag, useScreening, type ScreeningMovie, type ScreeningState } from '@/lib/screening';
import { useLiveShare, type LiveShare } from '@/lib/liveshare';
import { bytes, isMagnet, useTorrent, type TorrentStatus } from '@/lib/torrent';
import { cn, named, norm, plural } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   The screening room, as a screen. Three things share this page and are
   deliberately kept apart:

   - `useScreening` is the room — who is here, what is playing, where the film
     is. The server owns it.
   - `useTorrent` is a receiver: it plays a link and knows nothing about the
     room; the room never learns what it is.
   - This file is the seam: it chooses a source, hands the stream to one
     `<video>`, and lets the room drive that element.

   The consequence worth stating: the sync engine works with any source, and the
   torrent path is the only one with failure modes of its own — which is why
   most of the words on this page belong to it.
   ══════════════════════════════════════════════════════════════════════════ */

/** What this member is playing. Everyone chooses their own; the room only syncs. */
type Source =
  | { kind: 'none' }
  /** The receiver owns the element; there is no URL to hand anybody. */
  | { kind: 'torrent' }
  /* Nothing on this screen can choose this any more — the field that did is
     gone. It survives for one path: adopting a room whose link is not a magnet,
     which the server still accepts and an older tab could still have published.
     A member arriving into that session gets a picture instead of a dead end. */
  | { kind: 'url'; url: string };

/* Kept in this browser and remembered between films, because it is not a fact
   about the subtitle — it is a fact about the screen it is read on. Same reason
   the offset is per-person, one step further out: the offset belongs to the
   copy, this belongs to the seat.

   A percentage of whatever the browser was already going to use: the UA sizes
   cues from the size of the video, so 100 is "leave it alone". */
const SUB_SIZE = 'cineclube.legenda-tamanho';
const SUB_SIZE_MIN = 40;
const SUB_SIZE_MAX = 200;
const SUB_SIZE_STEP = 10;

/* How long the film waits for the rest of the club to load the source before
   starting anyway. Long enough for a magnet to resolve on a swarm of one
   seeder, short enough that a tab left open on somebody's second monitor —
   which will never choose anything — does not hold up the evening. */
const START_GRACE_MS = 20_000;

/* Narrower than the page, and the picture is the reason: at the column's full
   width the video is edge to edge with no dark to sit the frame against, and
   every control underneath is stranded at the far ends of a line the eye has to
   travel to read as one row.

   The whole screen moves in together, not just the video: a player at 900 with
   a status bar at 1240 under it is not a smaller player, it is a player that
   lost an argument with the layout. */
const ROOM = 'mx-auto w-full max-w-[900px]';

/* ── subtitles ────────────────────────────────────────────────────────────
   A `<track>` only speaks WebVTT, and what people have on disk is almost always
   SubRip — close enough that converting is a header and a punctuation change.

   O deslocamento não é luxo: um arquivo de legenda achado separado do vídeo
   costuma estar um ou dois segundos fora. Aplicado reescrevendo os carimbos e
   não movendo as cues ao vivo, porque um arquivo refeito é um estado que o
   player recebe limpo, e uma lista de cues mutada é um que ele meio percebe. */

/** SubRip is UTF-8 as often as it is Windows-1252, and neither says which. */
async function readSubtitle(file: File) {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    // Not valid UTF-8, so it is the other one — the encoding Brazilian subtitle
    // files have been written in for twenty years.
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

const STAMP = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})/g;

function vttStamp(seconds: number) {
  const total = Math.max(0, Math.round(seconds * 1000));
  const pad = (n: number, size = 2) => String(n).padStart(size, '0');
  return `${pad(Math.floor(total / 3600000))}:${pad(Math.floor(total / 60000) % 60)}:${pad(
    Math.floor(total / 1000) % 60
  )}.${pad(total % 1000, 3)}`;
}

/** SubRip in, WebVTT out, shifted by `offset` seconds on the way through. */
function toVtt(raw: string, offset: number) {
  const body = raw.replace(/^﻿/, '').replace(/\r/g, '');
  const shifted = body.replace(STAMP, (_all, h, m, s, ms) => {
    const at = Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
    return vttStamp(at + offset);
  });
  return /^WEBVTT/.test(shifted) ? shifted : `WEBVTT\n\n${shifted}`;
}

/* ── o que vem antes e o que vem depois ───────────────────────────────────
   Uma série se vê em fila, e até agora andar nela era encerrar a sessão, abrir
   o seletor, achar a série, achar a temporada e achar o número — cinco passos
   para a coisa mais previsível que este clube faz. Para trás valia o mesmo:
   abriu o errado, ou a mesa quis rever o anterior antes de seguir.

   Descoberto e não adivinhado: `episódio ± 1` não existe nas pontas da
   temporada, e uma temporada não começa nem termina sempre no mesmo número.
   Buscar a temporada responde isso E deixa os vizinhos em cache, que é a
   condição de a sala poder abri-los — as duas coisas pelo preço de uma.

   Não ter vizinho é um estado e não um erro: o primeiro episódio da primeira
   temporada não tem anterior, e uma falha de rede aqui só apaga um botão. */
type Neighbour = { season: number; episode: number; title: string };

const asNeighbour = (e: Episode): Neighbour => ({
  season: e.season,
  episode: e.episode,
  title: e.title,
});

function useNeighbours(movie: ScreeningMovie | null) {
  const [around, setAround] = useState<{ prev: Neighbour | null; next: Neighbour | null }>({
    prev: null,
    next: null,
  });

  const showId = movie?.kind === 'episode' ? movie.id : null;
  const season = movie?.season ?? null;
  const episode = movie?.episode ?? null;

  useEffect(() => {
    setAround({ prev: null, next: null });
    if (showId == null || season == null || episode == null) return;

    let alive = true;
    void (async () => {
      const atual = await seriesApi.season(showId, season);
      const onde = atual.season.episodes.findIndex(e => e.episode === episode);
      const antes = onde > 0 ? atual.season.episodes[onde - 1] : null;
      const depois = onde >= 0 ? atual.season.episodes[onde + 1] : null;
      if (alive) {
        setAround({
          prev: antes ? asNeighbour(antes) : null,
          next: depois ? asNeighbour(depois) : null,
        });
      }
      // Dentro da temporada nos dois lados: nada mais a perguntar.
      if (antes && depois) return;

      /* Uma ponta, ou as duas. A temporada vizinha é a da LISTA da série e não
         `temporada ± 1`: especiais são a zero, e uma série pode pular número. */
      const { show } = await seriesApi.show(showId);
      const todas = show.seasons ?? [];
      const aqui = todas.findIndex(s => s.season === season);
      if (aqui < 0) return;

      /* A ponta de cá pega o ÚLTIMO da temporada anterior, e a de lá o primeiro
         da seguinte — é assim que "anterior" atravessa uma virada de temporada
         sem a pessoa ter de saber onde a outra terminou. */
      if (!antes && todas[aqui - 1]) {
        const r = await seriesApi.season(showId, todas[aqui - 1].season);
        const ultimo = r.season.episodes[r.season.episodes.length - 1];
        if (ultimo && alive) setAround(a => ({ ...a, prev: asNeighbour(ultimo) }));
      }
      if (!depois && todas[aqui + 1]) {
        const r = await seriesApi.season(showId, todas[aqui + 1].season);
        const primeiro = r.season.episodes[0];
        if (primeiro && alive) setAround(a => ({ ...a, next: asNeighbour(primeiro) }));
      }
    })().catch(() => {
      /* sem vizinho é um estado; ver acima */
    });

    return () => {
      alive = false;
    };
  }, [showId, season, episode]);

  return around;
}

/** What `MediaError.code` means, said to somebody who just saw a black screen. */
function playbackFailure(code: number) {
  if (code === 2) return 'A fonte caiu no meio da reprodução.';
  if (code === 3 || code === 4) {
    return 'Seu navegador não consegue decodificar este arquivo. Costuma ser áudio AC3/DTS ou vídeo HEVC dentro do .mkv.';
  }
  return null;
}

/* ── uma sala, duas lentes ────────────────────────────────────────────────
   A sessão é do CLUBE e não do universo: a mesma sala, a mesma gente e o mesmo
   motor de sincronia, com um filme ou um episódio dentro. Por isso esta tela
   recebe por prop o pouco que muda entre as duas — o que se escolhe para abrir,
   e para onde vai quem termina — em vez de ler um contexto que só uma delas
   tem. O resto (quem é você, o retrato de cada um, o toast de erro) sai do
   `World`, que as duas montam.

   O seletor não é um render prop porque quem abre a sessão é esta tela: passar
   a função de abrir para fora e receber JSX de volta seria a mesma escolha
   escrita em dois lugares. */
export function ScreeningScreen({
  watchlist,
  shows,
  onRate,
  onSeen,
}: {
  /** A fila de filmes do clube. Ausente na lente de séries. */
  watchlist?: WatchItem[];
  /** As séries do clube. Ausente na lente de filmes. */
  shows?: QueuedShow[];
  /** O passo seguinte a assistir, que cada lente resolve na tela dela. */
  onRate: (movie: ScreeningMovie) => void;
  /* A sala deixou um episódio para trás e o marcou como visto para quem estava
     dentro. Quem chamou esta tela guarda o acervo e é quem sabe relê-lo. */
  onSeen?: () => void;
}) {
  const club = useWorld();
  const screening = useScreening(club.fault);
  const torrent = useTorrent();
  /* O segundo modo da sala. Ele não conversa com o torrent nem com o motor de
     sincronia: quando há alguém transmitindo, aqueles dois não têm trabalho —
     não existe cópia local para sincronizar. Ver lib/liveshare.ts. */
  const liveShare = useLiveShare(screening, club.me.id);
  const { state, connected, setReady } = screening;
  /** A sala inteira muda de natureza enquanto isto é verdade. */
  const liveOn = state.live !== null;
  /* A sessão é de quem a abriu: o play, o pause e a barra são dela, e as outras
     três telas assistem. Uma sala sem dono é de todo mundo — uma sessão aberta
     antes desta regra continua utilizável em vez de ficar travada. */
  const iHaveControl = !state.host || state.host.id === club.me.id;
  /* Os episódios em volta, quando o que está tocando é um. Só na tela de quem
     pode abri-los: descobrir custa uma pergunta ao TMDB por episódio, e nas
     outras três ela pagaria para acender botões que elas não têm. */
  const { prev, next } = useNeighbours(iHaveControl ? state.movie : null);

  const [source, setSource] = useState<Source>({ kind: 'none' });
  /** Of the local file, once the player has read it. Half of the file's identity. */
  const [duration, setDuration] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** The room's file as WebVTT at offset zero; the shifted copy derives from it. */
  const [subFile, setSubFile] = useState<{ name: string; raw: string } | null>(null);
  const [subOffset, setSubOffset] = useState(0);
  const [subsOn, setSubsOn] = useState(true);
  const [subtitle, setSubtitle] = useState<{ url: string; label: string } | null>(null);
  const [subSize, setSubSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(SUB_SIZE));
      return saved >= SUB_SIZE_MIN && saved <= SUB_SIZE_MAX ? saved : 100;
    } catch {
      return 100; // storage refused: the default is not worth an exception
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SUB_SIZE, String(subSize));
    } catch {
      /* it simply starts at the default next time */
    }
  }, [subSize]);

  /* O que está tocando, como uma string que muda quando ele muda. Era o id do
     filme, e isso é a mesma coisa para um filme e mentira para um episódio: o
     id de um episódio é o da SÉRIE, então passar ao seguinte não mexia em nada
     aqui — a sala trocava de obra e esta tela seguia com a fonte, a legenda e o
     "já começou" do episódio anterior. */
  const playing = state.movie;
  const workKey = playing
    ? `${playing.id}:${playing.season ?? ''}:${playing.episode ?? ''}`
    : null;
  const { stop: stopTorrent } = torrent;
  const { publishLink } = screening;
  /** The last link this browser told the room about. See `share` below. */
  const shared = useRef<string | null>(null);
  /** A link this member turned down, so adoption does not force it back. */
  const declined = useRef<string | null>(null);
  /** Whether the film has been started. See "the film starting by itself". */
  const started = useRef(false);
  /** The subtitle text this browser holds, and the room's id it came from. */
  const heldSub = useRef<string | null>(null);
  const tookSub = useRef<number | null>(null);
  /** When this member's own picture became available; the grace runs from it. */
  const feedingSince = useRef<number | null>(null);

  /* ── passar ao seguinte marcou o anterior ────────────────────────────────
     A sala fez isso no servidor, no instante da virada e para todo mundo que
     estava dentro (ver a rota `/open`). Aqui só se relê: o acervo desta lente
     desenha o progresso, e ele acabou de ficar velho.

     Sobre o que SAIU e não sobre o que entrou — por isso a comparação é com o
     que esta tela tinha antes. Chegar numa sessão não marca nada. */
  const wasEpisode = useRef(false);
  useEffect(() => {
    if (wasEpisode.current) onSeen?.();
    wasEpisode.current = state.movie?.kind === 'episode';
  }, [workKey, state.movie?.kind, onSeen]);

  /* A different film is a different evening: the source, the receiver, the
     subtitles and the credits all belong to the last one. */
  useEffect(() => {
    setSource({ kind: 'none' });
    setDuration(null);
    setEnded(false);
    setFailure(null);
    setSubFile(null);
    setSubOffset(0);
    shared.current = null;
    declined.current = null;
    started.current = false;
    feedingSince.current = null;
    heldSub.current = null;
    tookSub.current = null;
    stopTorrent();
  }, [workKey, stopTorrent]);

  /* ── what this member is playing, said in one string ─────────────────────
     The infohash is exact: two people on the same hash have the same bytes, so
     the club can tell a shared copy from somebody's own rip without comparing
     anything but this. A URL is exact for the same reason. */
  const tag = useMemo(() => {
    /* Na tela ao vivo todo mundo está literalmente na mesma imagem, então o
       marcador é um só e igual para a sala inteira. Isso não é cosmético: é o
       que impede o aviso de "cópias diferentes" de disparar numa sessão em que
       cópia diferente é impossível. */
    if (state.live) return `live:${state.live.hostId}`;
    if (source.kind === 'torrent') return torrent.status.infoHash;
    if (source.kind === 'url') return source.url;
    return null;
  }, [source, torrent.status.infoHash, state.live]);

  /* The player reports readiness only when it changes, and a member whose film
     never stalls would therefore never say what they are watching. This is what
     puts the source on the board. */
  useEffect(() => {
    if (tag) void setReady(true, tag);
  }, [tag, setReady]);

  /* The element is shared: the receiver streams into it, and a local file wants
     its duration read off it. */
  const elemRef = useRef<HTMLVideoElement | null>(null);
  const { attach } = torrent;
  const holdElement = useCallback(
    (el: HTMLVideoElement | null) => {
      const previous = elemRef.current;
      if (previous) previous.onloadedmetadata = null;
      elemRef.current = el;
      if (el) {
        el.onloadedmetadata = () => {
          setDuration(Number.isFinite(el.duration) ? Math.round(el.duration) : null);
        };
      }
      attach(el);
    },
    [attach]
  );

  /* Peers seen at the best moment, which is what turns "nobody is here" into
     the two different sentences it can mean: never arrived, or left. */
  const peak = useRef(0);
  useEffect(() => {
    if (torrent.status.peers > peak.current) peak.current = torrent.status.peers;
  }, [torrent.status.peers]);
  useEffect(() => {
    peak.current = 0;
  }, [torrent.status.infoHash]);

  /* The file the `<track>` actually loads: the imported one, rebuilt at the
     current offset. The cleanup is what keeps a shifted copy from leaking on
     every press of the nudge. */
  useEffect(() => {
    if (!subFile) {
      setSubtitle(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([toVtt(subFile.raw, subOffset)], { type: 'text/vtt' }));
    setSubtitle({ url, label: subFile.name });
    return () => URL.revokeObjectURL(url);
  }, [subFile, subOffset]);

  /* Showing or hiding is a property of the track, not of the markup, so it is
     set on the element. `addtrack` is here because the track is parsed
     asynchronously: setting the mode before it exists is a silent no-op, and
     the subtitles never appear. */
  useEffect(() => {
    const el = elemRef.current;
    if (!el) return;
    const apply = () => {
      for (const track of Array.from(el.textTracks)) track.mode = subsOn ? 'showing' : 'hidden';
    };
    apply();
    el.textTracks.addEventListener('addtrack', apply);
    return () => el.textTracks.removeEventListener('addtrack', apply);
  }, [subsOn, subtitle]);

  /* O filme não pode ser entregue — são gigabytes num disco só —, mas a legenda
     são cem kilobytes de texto, e quatro pessoas caçando o mesmo .srt é a
     mesma tarefa que a sala existe para abolir.

     Convertida para WebVTT aqui e não em cada navegador que recebe: a conversão
     pertence a onde o arquivo foi aberto, e a sala guarda um formato em vez de
     dois. Sempre em deslocamento zero — o ajuste é a parte que continua
     pessoal, porque é fato sobre a SUA cópia do filme. */
  const { publishSubtitle, fetchSubtitle } = screening;

  const importSubtitle = useCallback(
    async (file: File) => {
      const vtt = toVtt(await readSubtitle(file), 0);
      setSubOffset(0);
      setSubsOn(true);
      heldSub.current = vtt;
      setSubFile({ name: file.name, raw: vtt });
      tookSub.current = await publishSubtitle({ name: file.name, vtt });
    },
    [publishSubtitle]
  );

  /* The other direction: the room announces a subtitle and whoever does not
     have it collects it. Only the id is compared, because the announcement is
     all the stream carries — the text is a separate request, made once. This is
     also how a member arriving in the second act gets the subtitles without
     asking, which is the whole point of putting it in the room. */
  const announcedSub = state.subtitle?.id ?? null;
  useEffect(() => {
    if (announcedSub === null) {
      // Somebody removed it. It was the room's, so it goes from every screen.
      if (tookSub.current === null) return;
      tookSub.current = null;
      heldSub.current = null;
      setSubFile(null);
      setSubOffset(0);
      return;
    }
    if (announcedSub === tookSub.current) return;
    tookSub.current = announcedSub;

    let alive = true;
    void fetchSubtitle().then(
      got => {
        /* Already holding this exact text: our own upload coming back round the
           stream, because the frame can beat the reply to the POST. Rebuilding
           the blob would replace a live `<track>` for no reason, and a browser
           shows that as the subtitles blinking out mid-line. */
        if (!alive || got.vtt === heldSub.current) return;
        heldSub.current = got.vtt;
        setSubFile({ name: got.name, raw: got.vtt });
        // A different file is a different timing; the old shift means nothing.
        setSubOffset(0);
      },
      () => {
        /* One failed fetch is not worth a toast: the next announcement, or the
           next film, tries again, and the player is perfectly usable without. */
      }
    );
    return () => {
      alive = false;
    };
  }, [announcedSub, fetchSubtitle]);

  /* ── the pointer the club shares ─────────────────────────────────────────
     Published once per link and never in a loop: two members who each chose a
     different magnet would otherwise overwrite each other for as long as both
     tabs were open. The last one to choose wins, which is the same thing that
     happens in the chat. */
  const share = useCallback(
    (link: string | null) => {
      if (!link || shared.current === link) return;
      shared.current = link;
      void publishLink(link);
    },
    [publishLink]
  );

  const { receive, seed } = torrent;
  const chooseTorrent = useCallback(
    (input: string | File, mode: 'receive' | 'seed') => {
      setSource({ kind: 'torrent' });
      setEnded(false);
      setFailure(null);
      if (mode === 'seed') {
        void seed(input as File);
      } else {
        // Published straight away rather than after the engine resolves it: a
        // magnet with no peers never resolves, and the club would never learn
        // what to try.
        if (typeof input === 'string') share(input);
        void receive(input);
      }
    },
    [receive, seed, share]
  );

  /* Seeding produces a link that did not exist a moment ago, so it can only be
     shared once the engine has built it. */
  const seedMagnet = torrent.status.phase === 'seeding' ? torrent.status.magnet : null;
  useEffect(() => {
    if (seedMagnet) share(seedMagnet);
  }, [seedMagnet, share]);

  /* ── the film starting by itself ─────────────────────────────────────────
     Somebody drops the file and the evening should begin. Three conditions, and
     each one is a way this could be wrong:

     - Only the member who owns the session presses it: four browsers each
       sending the same play is four commands for one press, and whichever
       arrives last decides where the film starts. It used to be whoever
       published the source, which is the same person on most nights and the
       wrong one on the rest — the room takes commands from its owner alone, so
       an autoplay from anybody else is a 403 and a film that never starts.
     - Only at the top of a film nobody has started. A room paused in the second
       act is somewhere a person put it, and restarting that overrules them.
     - Only once the club has loaded the same source, or once the grace has run
       out — a tab open on a second monitor will never load anything and must
       not hold up the film.

     `duration` is the honest signal that this browser has a film rather than a
     promise of one: it exists only after the player opened what it was given. */
  const { send } = screening;

  const feeding =
    duration != null &&
    (source.kind === 'url' ||
      (source.kind === 'torrent' &&
        (torrent.status.phase === 'streaming' || torrent.status.phase === 'seeding')));

  useEffect(() => {
    if (!feeding) feedingSince.current = null;
    else feedingSince.current ??= Date.now();
  }, [feeding]);

  /* A room that is running was started by somebody — this one, or a person.
     Either way the question is settled and must not be asked again. */
  useEffect(() => {
    if (state.status === 'playing') started.current = true;
  }, [state.status]);

  const { viewers, open: roomOpen, status, position } = state;
  useEffect(() => {
    if (started.current || !roomOpen || !feeding) return;
    /* Nada disto vale numa tela ao vivo. Lá não há posição para começar do
       zero, e "play" não é um comando da sala — é a pessoa que transmite
       apertando play no player dela. */
    if (liveOn) return;
    if (status !== 'paused' || position > 1) return;
    if (!iHaveControl) return;

    const go = () => {
      if (started.current) return;
      started.current = true;
      void send('play', 0);
    };

    if (viewers.length > 0 && viewers.every(v => v.sourceTag)) return go();

    // The deadline is absolute rather than a fresh countdown, so the state
    // frames arriving every few seconds cannot keep pushing it away.
    const left = START_GRACE_MS - (Date.now() - (feedingSince.current ?? Date.now()));
    const id = window.setTimeout(go, Math.max(0, left));
    return () => window.clearTimeout(id);
  }, [roomOpen, status, position, viewers, feeding, send, liveOn, iHaveControl]);

  /* ── arriving into a session already under way ───────────────────────────
     The room knows what everyone else is watching, so a member who opens the
     tab in the middle of a film should not be shown an empty picker and left to
     ask in the chat. Only when nothing has been chosen here: adopting over
     somebody's own choice would be the app overruling them. */
  const roomLink = state.link;
  useEffect(() => {
    if (!state.open || !roomLink || source.kind !== 'none') return;
    /* Nem isto: adotar o link da sala enquanto alguém transmite poria um
       torrent para baixar atrás de uma imagem que já está chegando. */
    if (liveOn) return;
    if (roomLink === declined.current) return;
    // Adopted, not chosen — so it must not be published back as news.
    shared.current = roomLink;
    if (isMagnet(roomLink)) {
      setSource({ kind: 'torrent' });
      void receive(roomLink);
    } else {
      setSource({ kind: 'url', url: roomLink });
    }
  }, [state.open, roomLink, source.kind, receive, liveOn]);

  /* ── the drop that must never navigate ───────────────────────────────────
     A page that does not cancel `drop` hands the file to the browser, and the
     browser opens it — replacing the document. The app does not crash, it is
     *gone*: no React tree left to catch anything, nothing but the reload.

     Cancelling on the drop area alone was not enough: a drop a few pixels
     outside it is a drop on the page, and the page had no opinion. Releasing
     near a target is what dragging *is*, so the whole window says no and the
     target says yes. */
  useEffect(() => {
    const swallow = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  const openFilm = screening.openFilm;
  const openEpisode = screening.openEpisode;
  const closeFilm = screening.closeFilm;

  if (!state.open) {
    return (
      <section className={ROOM}>
        <Head connected={connected} viewers={state.viewers.length} />
        {shows ? (
          <EpisodePicker
            shows={shows}
            onPick={(showId, season, episode) => void openEpisode(showId, season, episode)}
          />
        ) : (
          <FilmPicker watchlist={watchlist ?? []} onPick={id => void openFilm(id)} />
        )}
      </section>
    );
  }

  const movie = state.movie!;
  const rateLabel = movie.kind === 'episode' ? 'Avaliar temporada' : 'Avaliar filme';
  const mine = tag;
  const different = state.viewers.filter(v => v.id !== club.me.id && v.sourceTag && mine && v.sourceTag !== mine);
  const waiting = state.viewers.filter(v => !v.ready);

  return (
    <section className={ROOM}>
      <Head connected={connected} viewers={state.viewers.length} />

      <div className="mt-6 flex flex-wrap items-start gap-4">
        <Poster src={movie.poster} alt={movie.title} className="h-[86px] w-[58px] flex-none" />
        <div className="min-w-[16ch] flex-1">
          <h1 className="font-display text-[26px] leading-none tracking-[0.04em] text-beam">{movie.title}</h1>
          {/* Numa série o título é o da SÉRIE, e sozinho ele não diz o que está
              tocando: quatro pessoas sentam para ver "o quinto" e são episódios
              diferentes. O número vem primeiro porque é ele que identifica; o
              nome do episódio, quando há, vem atrás. */}
          {episodeTag(movie) ? (
            <p className="mt-1.5 text-[14px] leading-none text-beam-hot">
              <span className="q font-semibold">{episodeTag(movie)}</span>
              {movie.episodeTitle ? <span className="text-ink"> · {movie.episodeTitle}</span> : null}
            </p>
          ) : null}
          <p className="q mt-2 text-[12.5px] text-ink-dim">
            {[movie.year, movie.genre, runtimeOf(movie.runtime)].filter(Boolean).join(' · ')}
          </p>
          {/* Dito em toda tela, e não só nas três que não mandam: um controle
              que obedece a uma pessoa é uma regra da sala, e uma regra que só
              aparece quando ela te barra lê como defeito. */}
          {state.host ? (
            <p className="q mt-1.5 text-[11.5px] text-ink-faint">
              {iHaveControl
                ? 'Sessão sua — o play, o pause e a barra respondem a você.'
                : `Sessão de ${state.host.name} — o player responde a quem abriu.`}
            </p>
          ) : null}
        </div>
        {/* ── dois grupos, e a divisão é o que eles fazem ──────────────────
            Andar na série troca o que a sala está vendo; avaliar e encerrar são
            sobre esta noite. Estavam numa fileira só, e no telefone as quatro
            chaves caíam em duas linhas de dois misturando as duas naturezas —
            "Avaliar temporada" ao lado de "Anterior", "Próximo" ao lado de
            "Encerrar sessão".

            No telefone os grupos são linhas: o par de andar em cima, porque é o
            que se aperta a noite toda, e o resto embaixo. No computador ficam
            lado a lado com um fio entre eles. */}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-start sm:gap-3">
          {/* Só para o dono, e pela mesma razão do botão de encerrar: andar na
              série é trocar o que a sala inteira está vendo. O anterior
              primeiro, porque é a ordem em que os dois números estão. */}
          {iHaveControl && (prev || next) ? (
            <div className="flex flex-wrap gap-2 sm:border-r sm:border-house-rail sm:pr-3">
              {prev ? (
                <StepKey
                  step={prev}
                  back
                  onGo={() => void openEpisode(movie.id, prev.season, prev.episode)}
                />
              ) : null}
              {next ? (
                <StepKey
                  step={next}
                  onGo={() => void openEpisode(movie.id, next.season, next.episode)}
                />
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-start gap-2">
            {/* Ir avaliar é o passo seguinte a assistir, e até agora custava
                sair da sessão, achar o filme no catálogo e abri-lo de novo.
                Fica aqui, ao lado do filme que se está avaliando, e não junto
                dos controles da fonte — avaliar é sobre a obra, trocar fonte é
                sobre esta aba. */}
            <RateKey
              /* Sair daqui desmonta a tela, e desmontar a tela destrói o motor.
                 Para quem semeia com gente pendurada, esse clique é o fim do
                 filme para os outros — então ele pergunta antes, e só nesse
                 caso. */
              costsTheRoom={torrent.status.phase === 'seeding' && torrent.status.peers > 0}
              label={rateLabel}
              onRate={() => onRate(movie)}
            />
            {/* Encerrar é o maior dos comandos do player: apaga a sala para os
                quatro. Some da tela de quem não é o dono em vez de ficar ali
                para ser recusado pelo servidor. */}
            {iHaveControl ? (
              <Key tone="danger" onClick={() => void closeFilm()}>
                Encerrar sessão
              </Key>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── a tela ao vivo tem precedência sobre tudo ─────────────────────
          Não é uma terceira opção ao lado das outras: enquanto alguém está
          transmitindo, a sala inteira está naquele modo, e mostrar o seletor de
          arquivo por baixo seria oferecer um segundo filme durante o primeiro.
          Quem quiser voltar ao modo arquivo para a transmissão — o que é uma
          decisão da sala, e não desta aba. */}
      {liveOn ? (
        <LiveScreen live={state.live!} share={liveShare} me={club.me.id} />
      ) : source.kind === 'none' ? (
        <SourcePanel
          onMagnet={value => chooseTorrent(value, 'receive')}
          onTorrentFile={file => chooseTorrent(file, 'receive')}
          onSeed={file => chooseTorrent(file, 'seed')}
          onShareScreen={() => void liveShare.start()}
          shareError={liveShare.error}
        />
      ) : (
        <div className="mt-6">
          <SyncedVideo
            screening={screening}
            src={source.kind === 'url' ? source.url : null}
            sourceTag={tag}
            canControl={iHaveControl}
            onElement={holdElement}
            onEnded={() => setEnded(true)}
            onPlaybackError={code => setFailure(playbackFailure(code))}
            subtitle={subtitle}
            subtitleSize={subSize}
            poster={movie.poster}
          />

          {failure ? (
            <div className="mt-3">
              <Fault detail="ffmpeg -i filme.mkv -c:v copy -c:a aac -movflags +faststart filme.mp4">
                {failure}
              </Fault>
            </div>
          ) : null}

          {/* ── the booth ─────────────────────────────────────────────────────
              Everything here used to sit straight on the room: four rows of
              loose text and unlit buttons under the picture, each one floating
              at its own distance from the last, with nothing saying they were
              one thing. They are one thing — the controls of the machine
              showing the film — so they get one surface, and the rule that runs
              across it separates what belongs to the subtitle from what belongs
              to the source. */}
          <div className="plate mt-3 px-4 py-3.5">
            <SubtitleBar
              subtitle={subtitle}
              on={subsOn}
              offset={subOffset}
              size={subSize}
              onImport={file => void importSubtitle(file)}
              onToggle={() => setSubsOn(v => !v)}
              onNudge={by => setSubOffset(o => Math.round((o + by) * 10) / 10)}
              onResize={by =>
                setSubSize(v => Math.min(SUB_SIZE_MAX, Math.max(SUB_SIZE_MIN, v + by)))
              }
              onClear={() => {
                heldSub.current = null;
                setSubFile(null);
                setSubOffset(0);
                // The subtitle is the room's, so removing it removes it for all.
                void publishSubtitle(null);
              }}
            />

            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t border-house-rail pt-3.5">
              <SourceLine source={source} torrent={torrent.status} peaked={peak.current > 0} />
              <button
                type="button"
                onClick={() => {
                  stopTorrent();
                  setSource({ kind: 'none' });
                  setDuration(null);
                  setFailure(null);
                  /* The room's pointer stays where it is — this is one person
                     changing their own screen, not the club changing films. But
                     without this the adoption below would put the same link
                     straight back, and the button would do nothing at all. */
                  declined.current = state.link;
                }}
                className="font-display text-[12px] uppercase tracking-[0.12em] text-ink-dim transition-colors hover:text-beam"
              >
                Trocar fonte
              </button>
            </div>

            {/* What used to be a field with the magnet in it, to be copied into
                the chat by hand. The room publishes that link by itself the
                moment the engine builds it, so the field was a leftover errand
                — but the sentence under it was not, and it is the one thing the
                seeder genuinely needs to know. */}
            {torrent.status.phase === 'seeding' ? (
              <p className="q mt-2.5 max-w-[60ch] text-[11.5px] text-ink-dim">
                Enquanto esta aba estiver aberta, o filme está no ar para o clube. Fechar aqui derruba
                a fonte.
              </p>
            ) : null}
          </div>

          {ended ? (
            <div className="plate mt-3 flex flex-wrap items-center gap-3 px-4 py-3.5">
              <span className="legend">Fim de sessão</span>
              {/* A mesma porta e a mesma pergunta da chave lá em cima. Os
                  créditos rolando aqui não querem dizer que rolaram para todo
                  mundo — cópias diferem em alguns segundos — então a fonte que
                  sai neste instante ainda pode cortar o fim de alguém. */}
              <RateKey
                costsTheRoom={torrent.status.phase === 'seeding' && torrent.status.peers > 0}
                label={rateLabel}
                onRate={() => onRate(movie)}
              />
              {/* Onde a chave mais serve: os créditos subiram e a pergunta da
                  mesa é essa. Depois de avaliar, porque é essa a ordem de uma
                  noite — o que se acabou de ver, e só então o seguinte. Sem o
                  anterior: nos créditos ninguém volta, e a chave dele continua
                  no alto para quem abriu o errado. */}
              {next && iHaveControl ? (
                <StepKey
                  step={next}
                  onGo={() => void openEpisode(movie.id, next.season, next.episode)}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <AboutFilm movie={movie} />

      {/* ── the club, and what it is waiting for ────────────────────────────
          A plate for the same reason the booth is one: this is a list, and a
          list of people floating on the wall under a caption is not read as a
          list. The seats go a shade darker than the plate they sit on — they
          were house-seat on the room, and house-seat on house-seat is nothing
          at all. */}
      <div className="plate mt-6 px-4 py-4">
        <span className="legend">Na sessão</span>
        <div className="mt-3 flex flex-wrap gap-2">
          {state.viewers.map(v => (
            <span
              key={v.id}
              title={v.sourceTag ?? 'ainda escolhendo a fonte'}
              className={cn(
                'flex items-center gap-2 rounded-cell bg-house-deep/80 px-2.5 py-1.5 ring-1',
                v.ready ? 'ring-house-rail' : 'ring-dye-red-lit/60'
              )}
            >
              <Reel color={reelColor(v.dot, v.id)} src={club.avatarOf(v.id)} size="sm">
                {initialsOf(v.name)}
              </Reel>
              <span className="text-[12.5px] text-ink">{v.name}</span>
              {!v.ready ? <span className="q text-[11px] text-dye-red-lit">buffer</span> : null}
            </span>
          ))}
        </div>

        {/* ── quem está carregando, e o que o clube faz com isso ───────────
            Esta linha dizia "a sala pausou sozinha esperando fulano — e volta
            sozinha quando o buffer encher", porque era isso que acontecia. A
            sala não para mais por ninguém: uma sessão que para quando ninguém
            pediu e volta quando ninguém pediu foi pior, em todas as noites em
            que o clube sentou nela, do que seguir e alguém dizer "peraí".

            O que sobrou é o fato, sem a decisão em cima dele. Quem está atrás
            já aparece com o aro vermelho no painel; esta frase existe para o
            clube saber que a escolha é dele — apertar pause é uma coisa que
            quatro pessoas num Discord fazem sem pensar. */}
        {waiting.length ? (
          <p className="q mt-3 text-[12px] text-ink-dim">
            {waiting.map(v => v.name).join(', ')} {waiting.length === 1 ? 'está' : 'estão'} carregando. A
            sessão segue — pause se quiser esperar.
          </p>
        ) : null}

        {different.length ? (
          <div className="mt-3">
            <Fault detail={different.map(v => `${v.name}: ${v.sourceTag}`).join(' · ')}>
              {plural(different.length, 'pessoa está', 'pessoas estão')} com uma cópia diferente da sua. A
              sincronia continua valendo, mas o mesmo segundo pode ser outra cena.
            </Fault>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ── a ficha do filme, dentro da sessão ───────────────────────────────────
   A sala só carrega o que ela precisa para sincronizar — título, ano, gênero e
   duração —, e durante duas horas de filme o clube pergunta o resto: quem
   dirigiu, quem está no elenco, que nota o mundo deu, e onde este filme está
   passando para quem não tem cópia. Tudo isso já existe a uma rota de
   distância, e até agora custava sair da sessão para ler.

   Buscado por cada tela em vez de viajar no estado da sala, e a razão é a
   mesma que mantém a legenda fora dele: o snapshot é reemitido a cada mudança,
   vezes todo mundo conectado, e uma sinopse não muda no meio do filme. Aqui é
   uma requisição por pessoa por sessão, contra um catálogo que já responde
   isto para a ficha de projeção.

   Falha calada de propósito: a sessão não depende desta ficha, e um aviso
   vermelho sobre uma sinopse que não carregou, no meio do filme, é o app
   chamando atenção para o que ninguém pediu. */
/* Os dois detalhes respondem as mesmas perguntas com outros nomes — quem assina
   um filme é o diretor e quem assina uma série é quem a criou —, então a placa
   desenha esta forma e cada lente traduz a dela. */
type Sheet = {
  title: string;
  /** "dir. Fulano" ou "criação de Fulano". A linha, já escrita. */
  credit: string | null;
  overview: string | null;
  cast: string[];
  crowd: { score: number; votes: number } | null;
  trailerUrl: string | null;
  watch: Movie['watch'];
};

function AboutFilm({ movie: playing }: { movie: ScreeningMovie }) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const episode = playing.kind === 'episode';

  const { id } = playing;
  useEffect(() => {
    let alive = true;
    setSheet(null);
    /* `id` é do TMDB nas duas lentes e aponta para obras diferentes em cada uma:
       pedir a rota de filme com o id de uma série devolve outro título, com toda
       a confiança do mundo. É a razão de `kind` existir. */
    const asked: Promise<Sheet> = episode
      ? seriesApi.show(id).then(r => ({
          title: r.show.title,
          credit: r.show.creators.length ? `criação de ${r.show.creators.join(', ')}` : null,
          overview: r.show.overview,
          // O TMDB não dá elenco fixo de série na rota do detalhe.
          cast: [],
          crowd: r.show.crowd,
          trailerUrl: r.show.trailerUrl,
          watch: r.show.watch,
        }))
      : api<Movie>(`/api/catalog/movie/${id}`).then(m => ({
          title: m.title,
          credit: m.director ? `dir. ${m.director}` : null,
          overview: m.overview ?? null,
          cast: (m.cast ?? []).map(c => c.name),
          crowd: m.crowd ?? null,
          trailerUrl: m.trailerUrl ?? null,
          watch: m.watch,
        }));
    asked.then(
      s => alive && setSheet(s),
      () => {
        /* a sessão inteira funciona sem isto */
      }
    );
    return () => {
      alive = false;
    };
  }, [id, episode]);

  if (!sheet) return null;

  const facts = [sheet.credit, sheet.crowd ? `TMDB ${fmt(sheet.crowd.score)}` : null].filter(Boolean);

  return (
    <div className="plate mt-6 px-4 py-4">
      <span className="legend">{episode ? 'A série' : 'O filme'}</span>
      {facts.length ? <p className="q mt-2 text-[12px] text-ink-dim">{facts.join(' · ')}</p> : null}
      <p className="mt-2.5 max-w-[66ch] text-[13px] leading-relaxed text-ink-dim">
        {sheet.overview || 'Sem sinopse no TMDB.'}
      </p>
      {sheet.cast.length ? (
        <p className="mt-2.5 text-[12px] text-ink-dim">Elenco: {sheet.cast.join(', ')}</p>
      ) : null}
      {sheet.trailerUrl ? (
        <TrailerKey url={sheet.trailerUrl} title={sheet.title} className="mt-3" />
      ) : null}
      {/* A mesma resposta da folha de projeção: onde isto está incluído em algo
          que alguém do clube já paga. É a saída de quem entrou na sessão sem
          cópia nenhuma — e numa série vale mais ainda: quase todo filme dá para
          alugar, uma série ou está numa assinatura ou o clube não maratona. */}
      <WatchOn watch={sheet.watch} title={sheet.title} />
    </div>
  );
}

/* ── the header ───────────────────────────────────────────────────────────
   The connection is the one piece of status that has to be visible before
   anything else: every control on this page is a message to a server, and a
   page that quietly stopped listening looks exactly like a page where nobody
   pressed play. */
function Head({ connected, viewers }: { connected: boolean; viewers: number }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="legend">Sessão</span>
      <span className={cn('q text-[12px]', connected ? 'text-ink-dim' : 'text-dye-red-lit')}>
        {connected ? plural(viewers, 'pessoa na sala', 'pessoas na sala') : 'sem conexão com a sala'}
      </span>
    </div>
  );
}

/* ── choosing the film ────────────────────────────────────────────────────
   A fila é a porta principal e continua sendo, mas não pode ser a única: o
   clube decide na hora com muito mais frequência do que este picker admitia.
   O caminho era sair da sessão, achar o filme no catálogo, pôr na fila só para
   poder tirar depois, e voltar — e uma fila é uma intenção guardada, não uma
   permissão.

   Então o campo procura nos dois lugares ao mesmo tempo, e as duas respostas
   ficam separadas e nessa ordem: um filme que o clube já escolheu vale mais do
   que um que ele acabou de encontrar.

   Nada disto precisou de servidor: `/api/catalog/search` grava o que devolve em
   `movies_cache`, e é de lá que `/api/screening/open` lê o filme. */
function FilmPicker({ watchlist, onPick }: { watchlist: WatchItem[]; onPick: (id: number) => void }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Movie[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const timer = useRef<number>();

  const q = query.trim();
  const filtering = q.length > 0;

  /* O mesmo compasso do catálogo: 350ms depois da última tecla. Buscar a cada
     letra são oito requisições para uma palavra, e sete delas chegam já
     desatualizadas. */
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!q) {
      setFound(null);
      setSearching(false);
      setFailed(null);
      return;
    }
    setSearching(true);
    setFailed(null);
    timer.current = window.setTimeout(() => {
      api<{ results: Movie[] }>(`/api/catalog/search?q=${encodeURIComponent(q)}`)
        .then(r => setFound(r.results))
        .catch(e => {
          setFound([]);
          /* Cair aqui não é fatal: a fila continua filtrada e utilizável do lado
             de cá. A frase existe para ninguém concluir que o filme não existe
             quando o que faltou foi a rede. */
          setFailed((e as Error).message);
        })
        .finally(() => setSearching(false));
    }, 350);
    return () => window.clearTimeout(timer.current);
  }, [q]);

  const queued = filtering
    ? watchlist.filter(w => named(norm(q), w.title, w.original, w.english))
    : watchlist;

  /* O que já está na fila não se repete embaixo. O mesmo pôster duas vezes na
     mesma tela faz a pessoa parar para procurar a diferença entre eles. */
  const inQueue = new Set(watchlist.map(w => String(w.id)));
  const elsewhere = (found ?? []).filter(m => !inQueue.has(String(m.id)));

  return (
    <div>
      <div className="mb-5 max-w-[440px]">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Buscar um filme para a sessão…"
          hint={
            filtering
              ? searching
                ? 'procurando no TMDB…'
                : `${plural(queued.length, 'filme', 'filmes')} na fila · ${plural(
                    elsewhere.length,
                    'filme',
                    'filmes'
                  )} no TMDB`
              : 'a fila do clube, ou qualquer filme do TMDB'
          }
        />
      </div>

      {failed ? (
        <div className="mb-5 max-w-[60ch]">
          <Fault detail={failed}>
            Não foi possível buscar no TMDB. A fila abaixo continua valendo.
          </Fault>
        </div>
      ) : null}

      {/* A fila. Sem busca ela é a tela inteira e não ganha título: é a única
          coisa aqui, e nomear a única coisa de uma tela é falar duas vezes. */}
      {queued.length ? (
        <>
          {filtering ? <p className="legend mb-3">Na fila</p> : null}
          <PosterGrid
            films={queued.map(w => ({ id: Number(w.id), title: w.title, poster: w.poster }))}
            onPick={onPick}
          />
        </>
      ) : null}

      {/* O resto do cinema. Só com busca — sem ela não há o que mostrar, e uma
          seção vazia esperando conteúdo é uma promessa. */}
      {filtering && elsewhere.length ? (
        <>
          <p className={cn('legend mb-3', queued.length && 'mt-8')}>No TMDB</p>
          <PosterGrid
            films={elsewhere.map(m => ({ id: m.id, title: m.title, poster: m.poster ?? null }))}
            onPick={onPick}
          />
        </>
      ) : null}

      {/* Os vazios, e são três coisas diferentes: nunca houve nada, a busca não
          achou nada, e a busca ainda está indo. */}
      {!filtering && !watchlist.length ? (
        <Blank title="A fila está vazia">
          Marque alguma coisa em <span className="q">Quero ver</span>, ou procure um filme aqui em
          cima — a sessão abre com qualquer um.
        </Blank>
      ) : null}
      {filtering && !searching && !queued.length && !elsewhere.length ? (
        <Blank title="Nenhum filme com esse nome">
          A busca cobre a fila do clube e o TMDB inteiro. Tente o título original, se souber.
        </Blank>
      ) : null}
      {filtering && searching && !queued.length && !elsewhere.length ? (
        <p className="legend animate-flicker py-8">Procurando</p>
      ) : null}
    </div>
  );
}

/* ── escolhendo o episódio ────────────────────────────────────────────────
   Dois passos e não um, porque a coisa escolhida é uma tripla: a série, e
   depois qual episódio dela. É a mesma pergunta em duas metades, e juntá-las
   numa lista só seria uma lista de mil linhas por clube.

   Sem busca no TMDB, ao contrário do seletor de filmes: a sessão de uma série
   quase nunca é uma decisão de última hora — a série já está na lista do clube
   porque alguém a pôs lá para acompanhar, e é dessa lista que se continua.

   A temporada é buscada e não adivinhada, e isso é o que faz a sessão abrir:
   `/api/series/:id/season/:n` grava os episódios em `episodes_cache`, e é de lá
   que `/api/screening/open` lê a duração e o nome. Sem esta visita o servidor
   responde que não conhece o episódio. */
function EpisodePicker({
  shows,
  onPick,
}: {
  shows: QueuedShow[];
  onPick: (showId: number, season: number, episode: number) => void;
}) {
  /* Só o que a segunda metade precisa: um id para buscar as temporadas e um
     nome para escrever no cabeçalho. Uma série vinda da busca não é uma
     `QueuedShow` — não está no clube e não tem progresso —, e exigir a forma
     inteira aqui seria o seletor recusar tudo o que não está na lista. */
  const [chosen, setChosen] = useState<{ id: number; title: string } | null>(null);
  const [show, setShow] = useState<ShowDetail | null>(null);
  const [season, setSeason] = useState<SeasonDetail | null>(null);
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  /* A série escolhida traz as temporadas, e a primeira delas abre sozinha: a
     escolha seguinte é sempre um episódio, e obrigar um clique numa lista de uma
     ou duas linhas é um passo que não decide nada. */
  useEffect(() => {
    if (!chosen) return;
    let alive = true;
    setShow(null);
    setSeason(null);
    setSeasonNumber(null);
    setFailed(null);
    seriesApi.show(chosen.id).then(
      r => {
        if (!alive) return;
        setShow(r.show);
        const first = r.show.seasons?.[0]?.season;
        if (first != null) setSeasonNumber(first);
      },
      e => alive && setFailed((e as Error).message)
    );
    return () => {
      alive = false;
    };
  }, [chosen]);

  useEffect(() => {
    if (!chosen || seasonNumber == null) return;
    let alive = true;
    setSeason(null);
    setFailed(null);
    seriesApi.season(chosen.id, seasonNumber).then(
      r => alive && setSeason(r.season),
      e => alive && setFailed((e as Error).message)
    );
    return () => {
      alive = false;
    };
  }, [chosen, seasonNumber]);

  if (!chosen) {
    return (
      <ShowPicker shows={shows} onPick={setChosen} />
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={() => setChosen(null)}
          className="font-display text-[12px] uppercase tracking-[0.12em] text-ink-dim transition-colors hover:text-beam"
        >
          Trocar de série
        </button>
        <h2 className="font-display text-[22px] leading-none tracking-[0.04em] text-beam">
          {chosen.title}
        </h2>
      </div>

      {failed ? (
        <div className="mb-5 max-w-[60ch]">
          <Fault detail={failed}>Não foi possível falar com o TMDB agora.</Fault>
        </div>
      ) : null}

      {show?.seasons?.length ? (
        <div className="mb-5 flex flex-wrap gap-1.5">
          {show.seasons.map(s => (
            <button
              key={s.season}
              type="button"
              onClick={() => setSeasonNumber(s.season)}
              className={cn(
                'rounded-cell px-2.5 py-1.5 font-display text-[12px] uppercase tracking-[0.1em] ring-1 transition-colors',
                s.season === seasonNumber
                  ? 'text-beam ring-beam/60'
                  : 'text-ink-dim ring-house-rail hover:text-beam'
              )}
            >
              {s.season === 0 ? 'Especiais' : `T${s.season}`}
            </button>
          ))}
        </div>
      ) : null}

      {season ? (
        <ul className="flex flex-col">
          {season.episodes.map(e => (
            <EpisodeLine
              key={`${e.season}x${e.episode}`}
              episode={e}
              onPick={() => onPick(chosen.id, e.season, e.episode)}
            />
          ))}
        </ul>
      ) : failed ? null : (
        <p className="legend animate-flicker py-8">Abrindo a temporada</p>
      )}
    </div>
  );
}

/* O primeiro passo, e é o seletor de filmes com outro acervo: a lista do clube
   primeiro, o TMDB inteiro atrás dela. A regra é a mesma e o porquê também —
   uma lista é uma intenção guardada, não uma permissão, e o clube decide na
   hora com mais frequência do que uma lista admite.

   O que a série escolhida não precisa é estar no clube: a temporada é buscada
   do TMDB no passo seguinte, e é ela que grava o episódio em cache para a
   sessão poder abrir. */
function ShowPicker({
  shows,
  onPick,
}: {
  shows: QueuedShow[];
  onPick: (show: { id: number; title: string }) => void;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<SeriesItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const timer = useRef<number>();

  const q = query.trim();
  const filtering = q.length > 0;

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!q) {
      setFound(null);
      setSearching(false);
      setFailed(null);
      return;
    }
    setSearching(true);
    setFailed(null);
    timer.current = window.setTimeout(() => {
      seriesApi
        .search(q)
        .then(r => setFound(r.results))
        .catch(e => {
          setFound([]);
          setFailed((e as Error).message);
        })
        .finally(() => setSearching(false));
    }, 350);
    return () => window.clearTimeout(timer.current);
  }, [q]);

  const listed = filtering
    ? shows.filter(s => named(norm(q), s.title, s.original, s.english))
    : shows;
  const here = new Set(shows.map(s => String(s.id)));
  const elsewhere = (found ?? []).filter(s => !here.has(String(s.id)));

  return (
    <div>
      <div className="mb-5 max-w-[440px]">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Buscar uma série para a sessão…"
          hint={
            filtering
              ? searching
                ? 'procurando no TMDB…'
                : `${plural(listed.length, 'série', 'séries')} no clube · ${plural(
                    elsewhere.length,
                    'série',
                    'séries'
                  )} no TMDB`
              : 'as séries do clube, ou qualquer uma do TMDB'
          }
        />
      </div>

      {failed ? (
        <div className="mb-5 max-w-[60ch]">
          <Fault detail={failed}>
            Não foi possível buscar no TMDB. A lista do clube continua valendo.
          </Fault>
        </div>
      ) : null}

      {listed.length ? (
        <>
          {filtering ? <p className="legend mb-3">No clube</p> : null}
          <PosterGrid
            films={listed.map(s => ({ id: s.id, title: s.title, poster: s.poster }))}
            onPick={id => onPick(listed.find(s => s.id === id)!)}
            verb="Escolher"
          />
        </>
      ) : null}

      {filtering && elsewhere.length ? (
        <>
          <p className={cn('legend mb-3', listed.length && 'mt-8')}>No TMDB</p>
          <PosterGrid
            films={elsewhere.map(s => ({ id: s.id, title: s.title, poster: s.poster }))}
            onPick={id => onPick(elsewhere.find(s => s.id === id)!)}
            verb="Escolher"
          />
        </>
      ) : null}

      {!filtering && !shows.length ? (
        <Blank title="Nenhuma série no clube">
          Ponha uma em <span className="q">Minhas séries</span>, ou procure aqui em cima — a sessão
          abre com qualquer uma.
        </Blank>
      ) : null}
      {filtering && !searching && !listed.length && !elsewhere.length ? (
        <Blank title="Nenhuma série com esse nome">
          A busca cobre a lista do clube e o TMDB inteiro. Tente o título original, se souber.
        </Blank>
      ) : null}
      {filtering && searching && !listed.length && !elsewhere.length ? (
        <p className="legend animate-flicker py-8">Procurando</p>
      ) : null}
    </div>
  );
}

/* Uma linha e não um cartão: a pergunta aqui é "qual deles", numa lista
   ordenada em que o número na ponta responde. Vinte quadros 16:9 empilhados
   seriam vinte imagens quase idênticas de fundo escuro. */
function EpisodeLine({ episode, onPick }: { episode: Episode; onPick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        title={`Abrir sessão de ${episode.title}`}
        className="group flex w-full items-baseline gap-3 border-b border-house-rail py-2.5 text-left last:border-b-0"
      >
        <span className="q w-[52px] flex-none text-[12px] text-ink-dim">
          T{episode.season}E{String(episode.episode).padStart(2, '0')}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink transition-colors group-hover:text-beam">
          {episode.title}
        </span>
        {episode.runtime ? (
          <span className="q flex-none text-[11px] text-ink-faint">{runtimeOf(episode.runtime)}</span>
        ) : null}
      </button>
    </li>
  );
}

/* A grade de pôsteres, uma vez. As duas listas do picker desenham a mesma
   coisa, e a diferença entre elas — de onde o filme veio — já está dita na
   legenda acima de cada uma. */
function PosterGrid({
  films,
  onPick,
  verb = 'Abrir sessão de',
}: {
  films: { id: number; title: string; poster: string | null }[];
  onPick: (id: number) => void;
  /* Num filme o pôster ABRE a sessão; numa série ele só escolhe a série, e o
     episódio ainda vem. O `title` é a única coisa que diz isso, então ele não
     pode mentir. */
  verb?: string;
}) {
  return (
    /* Nenhum parágrafo explicando o que apertar um pôster faz. Ele abre a
       sessão, que é a única coisa para que esta tela serve. */
    <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
      {films.map(f => (
        <button
          key={f.id}
          type="button"
          onClick={() => onPick(f.id)}
          className="group text-left"
          title={`${verb} ${f.title}`}
        >
          <Poster
            src={f.poster}
            alt={f.title}
            className="aspect-[2/3] w-full transition-[box-shadow] duration-150 group-hover:ring-beam/70"
          />
          <span className="mt-2 block text-[12.5px] leading-tight text-ink-dim transition-colors group-hover:text-beam">
            {f.title}
          </span>
        </button>
      ))}
    </div>
  );
}

/* ── going to rate, and what it costs the seeder ──────────────────────────
   Toda noite acaba igual: sobem os créditos e todo mundo vai escrever o que
   achou. Só que sair não é de graça para todo mundo — esta tela é dona da
   engine de torrent, e trocar de rota a desmonta. Para quem recebe isso custa o
   próprio stream; para quem semeia é o filme acabando para a sala inteira.

   Então a chave pergunta antes, e só quando a resposta pode custar algo à sala:
   semeando, com alguém ainda conectado. Em todo outro caminho ela simplesmente
   vai — uma confirmação que aparece quando não há o que confirmar é como as
   pessoas aprendem a clicar através da que importava.

   Armada e não modal: um diálogo por cima de um filme que quatro pessoas ainda
   estão vendo é uma interrupção pior do que a coisa contra a qual ele avisa. */
/* A chave diz para ONDE vai, e não só que vai: o número é o que a mesa
   pergunta ("é o seis agora?"), e ele também é a única coisa que denuncia a
   virada de temporada antes de ela acontecer. */
function StepKey({ step, back, onGo }: { step: Neighbour; back?: boolean; onGo: () => void }) {
  return (
    <Key onClick={onGo} title={step.title}>
      {back ? 'Anterior' : 'Próximo'} · T{step.season}E{String(step.episode).padStart(2, '0')}
    </Key>
  );
}

function RateKey({
  costsTheRoom,
  label,
  onRate,
}: {
  costsTheRoom: boolean;
  /** "Avaliar filme" ou "Avaliar episódio": é a obra que muda, não a porta. */
  label: string;
  onRate: () => void;
}) {
  const [armed, setArmed] = useState(false);

  /* Disarms itself when the risk goes away — the last peer leaving, or the
     seed stopping — so a question nobody needs to answer does not sit on the
     screen waiting to be answered. */
  useEffect(() => {
    if (!costsTheRoom) setArmed(false);
  }, [costsTheRoom]);

  if (!armed) {
    return (
      <Key onClick={() => (costsTheRoom ? setArmed(true) : onRate())}>{label}</Key>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <p className="q max-w-[34ch] text-right text-[11.5px] text-ink-dim">
        Você é a fonte. Sair daqui agora tira a imagem de quem ainda está assistindo.
      </p>
      <div className="flex items-center gap-2">
        <Key tone="ghost" onClick={() => setArmed(false)}>
          Ficar
        </Key>
        <Key tone="commit" onClick={onRate}>
          Avaliar assim mesmo
        </Key>
      </div>
    </div>
  );
}

/* ── choosing the source ──────────────────────────────────────────────────
   Uma porta: o filme, arrastado ou escolhido. Tudo o mais que este painel já
   ofereceu era um link, e link é justamente o que este produto existe para não
   precisar — alguém caçando um, colando no chat, e quatro pessoas descobrindo
   juntas que ele não toca.

   O campo de URL direta era o último e o pior: funcionava em princípio, quase
   nunca na prática, e ficava embaixo da caixa de arrastar sugerindo que o
   caminho honesto era opcional. Um magnet solto aqui continua sendo entendido,
   porque isso custa uma linha em `take` e resgata quem tem um — só não é
   oferecido. */
/* ══════════════════════════════════════════════════════════════════════════
   A SALA, QUANDO ELA É A TELA DE ALGUÉM.

   Substitui o player e a cabine de uma vez, porque quase nada dali quer dizer
   alguma coisa aqui: a legenda não (o que chega é imagem pronta), a troca de
   fonte não (a fonte é uma pessoa), o aviso de cópias diferentes não (é
   impossível haver duas).

   O que sobra é o que a sala precisa saber: de quem é a tela, se a imagem está
   chegando, e como sair.
   ══════════════════════════════════════════════════════════════════════════ */
function LiveScreen({
  live,
  share,
  me,
}: {
  live: NonNullable<ScreeningState['live']>;
  share: LiveShare;
  me: string;
}) {
  const host = live.hostId === me;

  return (
    <div className="mt-6">
      <LiveVideo
        stream={share.stream}
        hostPreview={host}
        hostName={live.hostName}
        audio={
          host
            ? {
                sources: share.audioSources,
                currentId: share.audioSourceId,
                list: share.listAudio,
                pick: share.pickAudio,
              }
            : undefined
        }
      />

      <div className="plate mt-3 flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3.5">
        <span className="legend">{host ? 'Você está transmitindo' : `Tela de ${live.hostName}`}</span>

        {/* O estágio por extenso, e não uma roda. "Está preto" tem três causas
            com o mesmo desenho — não achou caminho, achou e não veio quadro,
            ou veio quadro e a tela está certa —, e sem esta linha não há como
            distinguir uma da outra sem abrir o console. */}
        <span className="q text-[12px] text-ink-dim">
          {share.phase === 'failed'
            ? share.error
            : host
              ? share.peers
                ? plural(share.peers, 'pessoa recebendo', 'pessoas recebendo')
                : (share.detail ?? 'ninguém recebendo ainda')
              : (share.detail ?? 'ao vivo')}
        </span>

        {host ? (
          <button
            type="button"
            onClick={share.stop}
            className="ml-auto font-display text-[12px] uppercase tracking-[0.12em] text-ink-dim transition-colors hover:text-dye-red-lit"
          >
            Parar de transmitir
          </button>
        ) : null}
      </div>

      {/* ── a falha que precisa ser dita antes de acontecer ───────────────
          Sem relay, quem estiver numa rede que não deixa duas máquinas se
          acharem — operadora móvel, e alguns provedores — não recebe imagem
          nenhuma. E não recebe em silêncio: a conexão fica tentando. Uma roda
          girando para sempre é a pior forma de dizer isso, então a sala diz
          antes, e só para quem está esperando. */}
      {!host && share.phase === 'waiting' && !share.relayed ? (
        <p className="q mt-2.5 max-w-[60ch] text-[11.5px] text-ink-dim">
          Se a imagem não chegar em alguns segundos, é a sua rede ou a dela não deixando as duas
          máquinas se acharem. Não há servidor de retransmissão contratado.
        </p>
      ) : null}

      {/* ── o filme mudo que só o clube percebe ───────────────────────────
          Quem transmite não tem como notar: o som continua saindo das caixas
          DELE. Do outro lado é um filme mudo, e a pessoa passa meia hora
          achando que é o volume dela.

          A frase muda conforme o que foi escolhido, porque a causa muda. Uma
          JANELA não carrega áudio em navegador nenhum — não é uma caixinha
          esquecida, é o modo errado, e mandar procurar uma opção que não
          existe ali seria a tela mentindo. */}
      {host && !share.hasAudio ? (
        <div className="mt-2.5">
          <Fault
            detail={
              share.surface === 'window'
                ? 'Compartilhe a TELA INTEIRA e marque “Compartilhar áudio do sistema”. Aí o som do VLC, do player ou de qualquer programa vai junto.'
                : 'Chrome/Edge: ao escolher a tela inteira, marque “Compartilhar áudio do sistema”; ao escolher uma aba, marque “Compartilhar áudio da aba”.'
            }
          >
            {share.surface === 'window'
              ? 'Compartilhamento de janela não leva som — o clube vê o filme mudo.'
              : 'Você está transmitindo sem som — o clube vê o filme mudo.'}
          </Fault>
        </div>
      ) : null}

      {/* A janela erra as duas coisas de uma vez: além de não ter som, ela tem
          a proporção que a pessoa deixou, e a imagem chega com tarja em vez de
          preencher. Dito uma vez, sem repetir o aviso de áudio acima. */}
      {host && share.surface === 'window' && share.hasAudio ? (
        <p className="q mt-2.5 max-w-[64ch] text-[11.5px] text-ink-dim">
          Compartilhando uma janela: a imagem chega na proporção dela, com tarja nas bordas. Tela
          inteira preenche melhor.
        </p>
      ) : null}

    </div>
  );
}

function SourcePanel({
  onMagnet,
  onTorrentFile,
  onSeed,
  onShareScreen,
  shareError,
}: {
  onMagnet: (value: string) => void;
  onTorrentFile: (file: File) => void;
  onSeed: (file: File) => void;
  onShareScreen: () => void;
  shareError: string | null;
}) {
  const [over, setOver] = useState(false);
  /* A file chosen here is the same file dropped on the box: it is seeded to the
     club and the session starts by itself. The dashed box is a target for the
     mouse, not a different feature — clicking and dragging must not be two
     routes with two outcomes. */
  const browse = useRef<HTMLInputElement | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const take = useCallback(
    (text: string, file: File | null) => {
      setRefused(null);
      const dropped = text.trim();
      if (dropped && isMagnet(dropped)) return onMagnet(dropped);

      if (!file) {
        return setRefused('Isso não é um magnet nem um arquivo que eu saiba abrir.');
      }
      if (/\.torrent$/i.test(file.name)) return onTorrentFile(file);
      if (file.type.startsWith('video/') || /\.(mp4|m4v|webm|mkv|avi|mov)$/i.test(file.name)) {
        return onSeed(file);
      }
      setRefused(`"${file.name}" não é um vídeo nem um .torrent.`);
    },
    [onMagnet, onSeed, onTorrentFile]
  );

  /* The listener sits on the whole panel and not on the dashed box, so the
     generous release — near the target, in the general direction of it — lands
     where the hand meant it to. The box is what the eye aims at; the panel is
     what actually catches. */
  const catches = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      // Only when the pointer left the panel itself, not when it crossed onto
      // a child — which fires `dragleave` and would flicker the whole state.
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      take(
        e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text'),
        e.dataTransfer.files?.[0] ?? null
      );
    },
  };

  return (
    <div className="mt-6 max-w-[68ch]" {...catches}>
      <div
        className={cn(
          'rounded-cell border border-dashed px-5 py-8 text-center transition-colors duration-150',
          over ? 'border-dye-brass bg-dye-brass/[0.06]' : 'border-house-rail bg-house-deep/60'
        )}
      >
        {/* Leads with the file because that is the path that works, and it is
            now the only one this box advertises. A magnet or a .torrent
            released here is still understood — that costs a line in `take` and
            saves somebody who has one — but it is no longer offered, because
            offering it sold a promise the browser cannot keep: a magnet from a
            torrent site announces on UDP trackers and DHT, and a tab reaches
            neither. */}
        <p className="font-display text-[15px] uppercase tracking-[0.14em] text-beam">
          Solte o arquivo do filme
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Key onClick={() => browse.current?.click()}>Escolher do computador</Key>
          <span className="q text-[11.5px] text-ink-dim">ou arraste até aqui</span>
        </div>
        <input
          ref={browse}
          type="file"
          accept="video/*,.mkv,.avi,.torrent"
          hidden
          onChange={e => {
            const file = e.target.files?.[0];
            // Cleared so choosing the same file twice still fires a change.
            e.target.value = '';
            if (file) take('', file);
          }}
        />

        {refused ? <p className="q mt-3 text-[11.5px] text-dye-red-lit">{refused}</p> : null}
      </div>

      {/* ── e o caminho que toca qualquer coisa ────────────────────────────
          Abaixo da caixa e não ao lado dela, porque não são dois iguais. O
          arquivo é o melhor jeito quando dá: cada pessoa recebe uma cópia, a
          qualidade não depende da subida de ninguém, e a sala tem seek e
          legenda de verdade. Isto é o que funciona quando aquilo não funciona
          — um .mkv que o navegador não decodifica, um serviço que só toca no
          player dele, um arquivo que ninguém quer distribuir.

          Sem legenda embaixo dos dois. O que elas explicavam — de onde vem o
          som, o que o DRM faz, por que uma aba é diferente de uma tela — só
          importa DEPOIS de a pessoa apertar, e é onde está agora: no seletor
          do navegador, e no aviso que aparece se a captura vier muda. Duas
          escolhas com um parágrafo cada viravam uma página para ler antes de
          poder começar. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-house-rail pt-4">
        <Key onClick={onShareScreen}>Compartilhar minha tela</Key>
      </div>

      {shareError ? <p className="q mt-2.5 text-[11.5px] text-dye-red-lit">{shareError}</p> : null}
    </div>
  );
}

/* ── what the source is doing ─────────────────────────────────────────────
   In torrent mode this is the only place the difference between "still
   arriving" and "never will" is visible, so it says which one it is in words
   rather than leaving a spinner to imply it. */
function SourceLine({
  source,
  torrent,
  peaked,
}: {
  source: Source;
  torrent: TorrentStatus;
  peaked: boolean;
}) {
  if (source.kind === 'url') {
    return <span className="q text-[12px] text-ink-dim">URL direta</span>;
  }
  if (source.kind === 'none') return null;

  const gone = peaked && torrent.peers === 0 && torrent.progress < 1 && torrent.phase === 'streaming';

  return (
    <div className="min-w-0 flex-1">
      {torrent.phase === 'error' ? (
        <Fault>{torrent.error}</Fault>
      ) : (
        <span className="q text-[12px] text-ink-dim">
          {torrent.phase === 'booting' && 'Ligando o motor…'}
          {torrent.phase === 'searching' && 'Lendo o link e procurando quem tem o arquivo…'}
          {(torrent.phase === 'streaming' || torrent.phase === 'seeding') &&
            [
              torrent.phase === 'seeding' ? 'semeando' : `${Math.round(torrent.progress * 100)}%`,
              plural(torrent.peers, 'peer', 'peers'),
              torrent.down > 0 ? `↓ ${bytes(torrent.down)}/s` : null,
              torrent.up > 0 ? `↑ ${bytes(torrent.up)}/s` : null,
              torrent.name,
            ]
              .filter(Boolean)
              .join(' · ')}
        </span>
      )}

      {gone ? (
        <p className="q mt-1 text-[11.5px] text-dye-red-lit">
          A fonte saiu do ar — quem estava semeando fechou a aba.
        </p>
      ) : torrent.lonely && torrent.phase !== 'seeding' ? (
        <p className="q mt-1 text-[11.5px] text-dye-red-lit">
          Ninguém está semeando isto. Peça para quem tem o arquivo abrir esta aba e soltar o vídeo aqui.
        </p>
      ) : null}

    </div>
  );
}

/* Quatro peças de um controle, numa casca só, divididas por fios: o que ele
   ajusta, menos, onde está, mais.

   Eram quatro coisas soltas numa fileira, cada grupo montado diferente do
   anterior, e o olho tinha de descobrir qual legenda mandava em quais botões.
   Os símbolos são os mesmos nos dois botões pela mesma razão: `A−`/`A+` ao lado
   de `−0,5s`/`+0,5s` lê como dois tipos de controle, e não são. */
function Stepper({
  label,
  value,
  onLess,
  onMore,
  less,
  more,
}: {
  label: string;
  /** Already formatted: this draws it, it does not know what it means. */
  value: string;
  onLess: () => void;
  onMore: () => void;
  /** What each key does, for anybody who cannot see which way it points. */
  less: string;
  more: string;
}) {
  const key =
    'flex w-8 items-center justify-center border-l border-house-rail font-display text-[15px] leading-none text-ink-dim transition-colors hover:bg-house-seat hover:text-beam';
  return (
    <div className="flex h-[30px] items-stretch overflow-hidden rounded-cell bg-house-deep/70 ring-1 ring-house-rail">
      <span className="flex items-center pl-3 pr-2.5 font-display text-[11px] uppercase leading-none tracking-[0.14em] text-ink-dim">
        {label}
      </span>
      <button type="button" onClick={onLess} aria-label={less} className={key}>
        −
      </button>
      {/* One width for both knobs, wide enough for the longest reading either
          of them can show, so a press moves the number and nothing else. */}
      <span className="q flex min-w-[6ch] items-center justify-center border-l border-house-rail px-1.5 text-[12px] leading-none text-ink">
        {value}
      </span>
      <button type="button" onClick={onMore} aria-label={more} className={key}>
        +
      </button>
    </div>
  );
}

/* O arquivo é do clube — uma pessoa acha e o player de todo mundo carrega. Os
   dois ajustes não são, e a divisão é deliberada:

   - o deslocamento pertence à sua CÓPIA do filme: dois membros com rips
     diferentes precisam de ajustes diferentes;
   - o tamanho pertence à sua TELA, que a sala não conhece. */
function SubtitleBar({
  subtitle,
  on,
  offset,
  size,
  onImport,
  onToggle,
  onNudge,
  onResize,
  onClear,
}: {
  subtitle: { url: string; label: string } | null;
  on: boolean;
  offset: number;
  size: number;
  onImport: (file: File) => void;
  onToggle: () => void;
  onNudge: (by: number) => void;
  onResize: (by: number) => void;
  onClear: () => void;
}) {
  return (
    /* No top margin of its own: it is the first row inside the booth plate,
       and the plate's padding is what stands it off the edge. */
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {subtitle ? (
        <>
          {/* ── the lamp ────────────────────────────────────────────────────
              The label used to be the state — "Legenda ligada" becoming
              "Legenda desligada" — which is two words longer in one position
              than the other, so pressing it shoved everything to its right
              along the row. A lamp says the same thing in a fixed width, and
              the room already has one: red, lit, the colour this product uses
              for something that is running. */}
          <button
            type="button"
            aria-pressed={on}
            onClick={onToggle}
            title={on ? 'Legenda ligada' : 'Legenda desligada'}
            className={cn(
              'flex h-[30px] items-center gap-2 rounded-cell px-3 font-display text-[11px] uppercase leading-none tracking-[0.14em] ring-1 transition-colors',
              on
                ? 'bg-dye-red/15 text-dye-red-lit ring-dye-red-lit/45'
                : 'text-ink-dim ring-house-rail hover:text-ink hover:ring-white/20'
            )}
          >
            <span
              aria-hidden
              className={cn(
                'h-1.5 w-1.5 rounded-full transition-colors',
                on ? 'bg-dye-red-lit shadow-[0_0_7px_rgba(242,86,74,0.85)]' : 'bg-ink-faint'
              )}
            />
            Legenda
          </button>

          <Stepper
            label="Sincronia"
            value={`${offset > 0 ? '+' : ''}${offset.toFixed(1).replace('.', ',')}s`}
            onLess={() => onNudge(-0.5)}
            onMore={() => onNudge(0.5)}
            less="Adiantar a legenda meio segundo"
            more="Atrasar a legenda meio segundo"
          />

          {/* The percentage is there to be read back, not to be aimed at. */}
          <Stepper
            label="Tamanho"
            value={`${size}%`}
            onLess={() => onResize(-SUB_SIZE_STEP)}
            onMore={() => onResize(SUB_SIZE_STEP)}
            less="Diminuir a legenda"
            more="Aumentar a legenda"
          />

          {/* What the file is called and how to be rid of it: the two things
              here that are about the subtitle rather than about watching it,
              so they go to the far end and stop sitting between the knobs. */}
          <div className="ml-auto flex items-center gap-3">
            <span className="q max-w-[22ch] truncate text-[11.5px] text-ink-dim" title={subtitle.label}>
              {subtitle.label}
            </span>
            <button
              type="button"
              onClick={onClear}
              className="font-display text-[11px] uppercase leading-none tracking-[0.14em] text-ink-dim transition-colors hover:text-dye-red-lit"
            >
              Remover
            </button>
          </div>
        </>
      ) : (
        <label className="flex flex-wrap items-center gap-3">
          <span className="legend">Legenda</span>
          <input
            type="file"
            accept=".srt,.vtt,text/vtt,application/x-subrip"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) onImport(file);
              // Cleared so choosing the same file twice still fires a change.
              e.target.value = '';
            }}
            className="max-w-full text-[12px] text-ink-dim file:mr-3 file:rounded-cell file:border-0 file:bg-house-seat file:px-3 file:py-2 file:font-display file:text-[12px] file:uppercase file:tracking-[0.12em] file:text-ink"
          />
          <span className="q text-[11.5px] text-ink-dim">.srt ou .vtt — vai para o clube inteiro</span>
        </label>
      )}
    </div>
  );
}
