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
import { inShell } from '@/lib/shell';
import { bytes, isMagnet, useTorrent, type TorrentStatus } from '@/lib/torrent';
import { cn, named, norm, plural } from '@/lib/utils';

type Source =
  | { kind: 'none' }
  | { kind: 'torrent' }
  | { kind: 'url'; url: string };

const SUB_SIZE = 'cineclube.legenda-tamanho';
const SUB_SIZE_MIN = 40;
const SUB_SIZE_MAX = 200;
const SUB_SIZE_STEP = 10;

const START_GRACE_MS = 20_000;

const ROOM = 'mx-auto w-full max-w-[900px]';

async function readSubtitle(file: File) {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
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

function toVtt(raw: string, offset: number) {
  const body = raw.replace(/^﻿/, '').replace(/\r/g, '');
  const shifted = body.replace(STAMP, (_all, h, m, s, ms) => {
    const at = Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
    return vttStamp(at + offset);
  });
  return /^WEBVTT/.test(shifted) ? shifted : `WEBVTT\n\n${shifted}`;
}

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
      if (antes && depois) return;

      const { show } = await seriesApi.show(showId);
      const todas = show.seasons ?? [];
      const aqui = todas.findIndex(s => s.season === season);
      if (aqui < 0) return;

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
    });

    return () => {
      alive = false;
    };
  }, [showId, season, episode]);

  return around;
}

function Medida({ share, host }: { share: LiveShare; host: boolean }) {
  const q = share.quality;
  if (!q || !q.height) return null;

  const mbps = q.kbps / 1000;
  const numeros = [
    `${q.width}×${q.height}`,
    q.fps ? `${q.fps} q/s` : null,
    mbps >= 0.1 ? `${mbps.toFixed(1)} Mb/s` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const porque =
    q.limit === 'cpu'
      ? host
        ? 'esta máquina não está dando conta de codificar — feche o que estiver pesado, ou transmita uma tela menor'
        : 'a máquina de quem transmite não está dando conta de codificar'
      : q.limit === 'bandwidth'
        ? host
          ? share.peers > 1
            ? `a subida está cheia — cada pessoa recebendo é outra cópia, e são ${share.peers}`
            : 'a subida desta rede está cheia'
          : 'a rede entre vocês não está dando a banda'
        : null;

  return (
    <p className="q mt-2 flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-faint">
      <span>{numeros}</span>
      {porque ? (
        <>
          <span aria-hidden>·</span>
          <span className="text-ink-dim">{porque}</span>
        </>
      ) : null}
    </p>
  );
}

function playbackFailure(code: number) {
  if (code === 2) return 'A fonte caiu no meio da reprodução.';
  if (code === 3 || code === 4) {
    return 'Seu navegador não consegue decodificar este arquivo. Costuma ser áudio AC3/DTS ou vídeo HEVC dentro do .mkv.';
  }
  return null;
}

export function ScreeningScreen({
  watchlist,
  shows,
  onRate,
  onSeen,
  onDuty,
}: {
  watchlist?: WatchItem[];
  shows?: QueuedShow[];
  onRate: (movie: ScreeningMovie) => void;
  onSeen?: () => void;
  onDuty?: (on: boolean) => void;
}) {
  const club = useWorld();
  const screening = useScreening(club.fault);
  const torrent = useTorrent();
  const liveShare = useLiveShare(screening, club.me.id);
  const { state, connected, setReady } = screening;

  const daSala = liveShare.role === 'host' || torrent.status.phase === 'seeding';
  useEffect(() => {
    if (daSala) {
      onDuty?.(true);
      return;
    }
    const id = window.setTimeout(() => onDuty?.(false), 5000);
    return () => window.clearTimeout(id);
  }, [daSala, onDuty]);
  const liveOn = state.live !== null;
  const iHaveControl = !state.host || state.host.id === club.me.id;
  const { prev, next } = useNeighbours(iHaveControl ? state.movie : null);

  const [source, setSource] = useState<Source>({ kind: 'none' });
  const [duration, setDuration] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [subFile, setSubFile] = useState<{ name: string; raw: string } | null>(null);
  const [subOffset, setSubOffset] = useState(0);
  const [subsOn, setSubsOn] = useState(true);
  const [subtitle, setSubtitle] = useState<{ url: string; label: string } | null>(null);
  const [subSize, setSubSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(SUB_SIZE));
      return saved >= SUB_SIZE_MIN && saved <= SUB_SIZE_MAX ? saved : 100;
    } catch {
      return 100;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SUB_SIZE, String(subSize));
    } catch {
    }
  }, [subSize]);

  const playing = state.movie;
  const workKey = playing
    ? `${playing.id}:${playing.season ?? ''}:${playing.episode ?? ''}`
    : null;
  const { stop: stopTorrent } = torrent;
  const { publishLink } = screening;
  const shared = useRef<string | null>(null);
  const declined = useRef<string | null>(null);
  const started = useRef(false);
  const heldSub = useRef<string | null>(null);
  const tookSub = useRef<number | null>(null);
  const feedingSince = useRef<number | null>(null);

  const wasEpisode = useRef(false);
  useEffect(() => {
    if (wasEpisode.current) onSeen?.();
    wasEpisode.current = state.movie?.kind === 'episode';
  }, [workKey, state.movie?.kind, onSeen]);

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

  const tag = useMemo(() => {
    if (state.live) return `live:${state.live.hostId}`;
    if (source.kind === 'torrent') return torrent.status.infoHash;
    if (source.kind === 'url') return source.url;
    return null;
  }, [source, torrent.status.infoHash, state.live]);

  useEffect(() => {
    if (tag) void setReady(true, tag);
  }, [tag, setReady]);

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

  const peak = useRef(0);
  useEffect(() => {
    if (torrent.status.peers > peak.current) peak.current = torrent.status.peers;
  }, [torrent.status.peers]);
  useEffect(() => {
    peak.current = 0;
  }, [torrent.status.infoHash]);

  useEffect(() => {
    if (!subFile) {
      setSubtitle(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([toVtt(subFile.raw, subOffset)], { type: 'text/vtt' }));
    setSubtitle({ url, label: subFile.name });
    return () => URL.revokeObjectURL(url);
  }, [subFile, subOffset]);

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

  const announcedSub = state.subtitle?.id ?? null;
  useEffect(() => {
    if (announcedSub === null) {
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
        if (!alive || got.vtt === heldSub.current) return;
        heldSub.current = got.vtt;
        setSubFile({ name: got.name, raw: got.vtt });
        setSubOffset(0);
      },
      () => {
      }
    );
    return () => {
      alive = false;
    };
  }, [announcedSub, fetchSubtitle]);

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
        if (typeof input === 'string') share(input);
        void receive(input);
      }
    },
    [receive, seed, share]
  );

  const seedMagnet = torrent.status.phase === 'seeding' ? torrent.status.magnet : null;
  useEffect(() => {
    if (seedMagnet) share(seedMagnet);
  }, [seedMagnet, share]);

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

  useEffect(() => {
    if (state.status === 'playing') started.current = true;
  }, [state.status]);

  const { viewers, open: roomOpen, status, position } = state;
  useEffect(() => {
    if (started.current || !roomOpen || !feeding) return;
    if (liveOn) return;
    if (status !== 'paused' || position > 1) return;
    if (!iHaveControl) return;

    const go = () => {
      if (started.current) return;
      started.current = true;
      void send('play', 0);
    };

    if (viewers.length > 0 && viewers.every(v => v.sourceTag)) return go();

    const left = START_GRACE_MS - (Date.now() - (feedingSince.current ?? Date.now()));
    const id = window.setTimeout(go, Math.max(0, left));
    return () => window.clearTimeout(id);
  }, [roomOpen, status, position, viewers, feeding, send, liveOn, iHaveControl]);

  const roomLink = state.link;
  useEffect(() => {
    if (!state.open || !roomLink || source.kind !== 'none') return;
    if (liveOn) return;
    if (roomLink === declined.current) return;
    shared.current = roomLink;
    if (isMagnet(roomLink)) {
      setSource({ kind: 'torrent' });
      void receive(roomLink);
    } else {
      setSource({ kind: 'url', url: roomLink });
    }
  }, [state.open, roomLink, source.kind, receive, liveOn]);

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
          {}
          {episodeTag(movie) ? (
            <p className="mt-1.5 text-[14px] leading-none text-beam-hot">
              <span className="q font-semibold">{episodeTag(movie)}</span>
              {movie.episodeTitle ? <span className="text-ink"> · {movie.episodeTitle}</span> : null}
            </p>
          ) : null}
          <p className="q mt-2 text-[12.5px] text-ink-dim">
            {[movie.year, movie.genre, runtimeOf(movie.runtime)].filter(Boolean).join(' · ')}
          </p>
          {}
          {state.host ? (
            <p className="q mt-1.5 text-[11.5px] text-ink-faint">
              {iHaveControl
                ? 'Sessão sua — o play, o pause e a barra respondem a você.'
                : `Sessão de ${state.host.name} — o player responde a quem abriu.`}
            </p>
          ) : null}
        </div>
        {}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-start sm:gap-3">
          {}
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
            {}
            <RateKey
              costsTheRoom={torrent.status.phase === 'seeding' && torrent.status.peers > 0}
              label={rateLabel}
              onRate={() => onRate(movie)}
            />
            {}
            {iHaveControl ? (
              <Key tone="danger" onClick={() => void closeFilm()}>
                Encerrar sessão
              </Key>
            ) : null}
          </div>
        </div>
      </div>

      {}
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

          {}
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
                  declined.current = state.link;
                }}
                className="font-display text-[12px] uppercase tracking-[0.12em] text-ink-dim transition-colors hover:text-beam"
              >
                Trocar fonte
              </button>
            </div>

            {}
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
              {}
              <RateKey
                costsTheRoom={torrent.status.phase === 'seeding' && torrent.status.peers > 0}
                label={rateLabel}
                onRate={() => onRate(movie)}
              />
              {}
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

      {}
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

        {}
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

type Sheet = {
  title: string;
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
    const asked: Promise<Sheet> = episode
      ? seriesApi.show(id).then(r => ({
          title: r.show.title,
          credit: r.show.creators.length ? `criação de ${r.show.creators.join(', ')}` : null,
          overview: r.show.overview,
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
      {}
      <WatchOn watch={sheet.watch} title={sheet.title} />
    </div>
  );
}

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

function FilmPicker({ watchlist, onPick }: { watchlist: WatchItem[]; onPick: (id: number) => void }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Movie[] | null>(null);
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
      api<{ results: Movie[] }>(`/api/catalog/search?q=${encodeURIComponent(q)}`)
        .then(r => setFound(r.results))
        .catch(e => {
          setFound([]);
          setFailed((e as Error).message);
        })
        .finally(() => setSearching(false));
    }, 350);
    return () => window.clearTimeout(timer.current);
  }, [q]);

  const queued = filtering
    ? watchlist.filter(w => named(norm(q), w.title, w.original, w.english))
    : watchlist;

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

      {}
      {queued.length ? (
        <>
          {filtering ? <p className="legend mb-3">Na fila</p> : null}
          <PosterGrid
            films={queued.map(w => ({ id: Number(w.id), title: w.title, poster: w.poster }))}
            onPick={onPick}
          />
        </>
      ) : null}

      {}
      {filtering && elsewhere.length ? (
        <>
          <p className={cn('legend mb-3', queued.length && 'mt-8')}>No TMDB</p>
          <PosterGrid
            films={elsewhere.map(m => ({ id: m.id, title: m.title, poster: m.poster ?? null }))}
            onPick={onPick}
          />
        </>
      ) : null}

      {}
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

function EpisodePicker({
  shows,
  onPick,
}: {
  shows: QueuedShow[];
  onPick: (showId: number, season: number, episode: number) => void;
}) {
  const [chosen, setChosen] = useState<{ id: number; title: string } | null>(null);
  const [show, setShow] = useState<ShowDetail | null>(null);
  const [season, setSeason] = useState<SeasonDetail | null>(null);
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

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

function PosterGrid({
  films,
  onPick,
  verb = 'Abrir sessão de',
}: {
  films: { id: number; title: string; poster: string | null }[];
  onPick: (id: number) => void;
  verb?: string;
}) {
  return (
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
  label: string;
  onRate: () => void;
}) {
  const [armed, setArmed] = useState(false);

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
      {}
      {host && share.surface === 'aparelho' ? (
        <div className="plate overflow-hidden">
          {share.thumb ? (
            <img
              src={share.thumb}
              alt="O que o clube está vendo"
              className="mx-auto block max-h-[46vh] w-auto"
            />
          ) : (
            <div className="flex items-center justify-center px-4 py-10 text-center">
              <p className="q max-w-[46ch] text-[12.5px] leading-relaxed text-ink-dim">
                Preparando a transmissão…
              </p>
            </div>
          )}
          <p className="q border-t border-white/[0.06] px-4 py-2 text-center text-[11px] text-ink-faint">
            Prévia a um quadro por segundo. O clube recebe a imagem inteira.
          </p>
        </div>
      ) : (
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
      )}

      <div className="plate mt-3 flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3.5">
        <span className="legend">{host ? 'Você está transmitindo' : `Tela de ${live.hostName}`}</span>

        {}
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

      <Medida share={share} host={host} />

      {}
      {!host && share.phase === 'waiting' && !share.relayed ? (
        <p className="q mt-2.5 max-w-[60ch] text-[11.5px] text-ink-dim">
          Se a imagem não chegar em alguns segundos, é a sua rede ou a dela não deixando as duas
          máquinas se acharem. Não há servidor de retransmissão contratado.
        </p>
      ) : null}

      {}
      {host && !share.hasAudio ? (
        <div className="mt-2.5">
          <Fault
            detail={
              share.surface === 'aparelho'
                ? 'O som só sai daqui enquanto alguma coisa estiver tocando no aparelho — e aplicativos com DRM (Netflix, Prime) entregam silêncio de propósito, do mesmo jeito que entregam tela preta. Se o filme está tocando e mesmo assim não há som, foi o aplicativo que recusou a captura.'
                : share.surface === 'window'
                ? 'Compartilhe a TELA INTEIRA e marque “Compartilhar áudio do sistema”. Aí o som do VLC, do player ou de qualquer programa vai junto.'
                : 'Chrome/Edge: ao escolher a tela inteira, marque “Compartilhar áudio do sistema”; ao escolher uma aba, marque “Compartilhar áudio da aba”.'
            }
          >
            {share.surface === 'aparelho'
              ? 'Ainda sem som — o clube vê o filme mudo.'
              : share.surface === 'window'
                ? 'Compartilhamento de janela não leva som — o clube vê o filme mudo.'
                : 'Você está transmitindo sem som — o clube vê o filme mudo.'}
          </Fault>
        </div>
      ) : null}

      {}
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

  const catches = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
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
        {}
        <p className="font-display text-[15px] uppercase tracking-[0.14em] text-beam">
          Solte o arquivo do filme
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Key onClick={() => browse.current?.click()}>
            {inShell() ? 'Escolher do aparelho' : 'Escolher do computador'}
          </Key>
          {inShell() ? null : (
            <span className="q text-[11.5px] text-ink-dim">ou arraste até aqui</span>
          )}
        </div>
        <input
          ref={browse}
          type="file"
          accept="video/*,.mkv,.avi,.torrent"
          hidden
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) take('', file);
          }}
        />

        {refused ? <p className="q mt-3 text-[11.5px] text-dye-red-lit">{refused}</p> : null}
      </div>

      {}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-house-rail pt-4">
        <Key onClick={onShareScreen}>
          {inShell() ? 'Transmitir a tela deste aparelho' : 'Compartilhar minha tela'}
        </Key>
      </div>

      {shareError ? <p className="q mt-2.5 text-[11.5px] text-dye-red-lit">{shareError}</p> : null}
    </div>
  );
}

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

function Stepper({
  label,
  value,
  onLess,
  onMore,
  less,
  more,
}: {
  label: string;
  value: string;
  onLess: () => void;
  onMore: () => void;
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
      {}
      <span className="q flex min-w-[6ch] items-center justify-center border-l border-house-rail px-1.5 text-[12px] leading-none text-ink">
        {value}
      </span>
      <button type="button" onClick={onMore} aria-label={more} className={key}>
        +
      </button>
    </div>
  );
}

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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {subtitle ? (
        <>
          {}
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

          {}
          <Stepper
            label="Tamanho"
            value={`${size}%`}
            onLess={() => onResize(-SUB_SIZE_STEP)}
            onMore={() => onResize(SUB_SIZE_STEP)}
            less="Diminuir a legenda"
            more="Aumentar a legenda"
          />

          {}
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
