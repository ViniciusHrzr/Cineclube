import { forwardRef, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Fault, Key } from '@/components/bits';
import { HolographicWall } from '@/components/ui/holographic-wall-shadcnui';
import { api, auth, fmt, type Review, type SessionUser } from '@/lib/api';
import { cn, plural } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   A PORTA DA RUA.

   Isto era um formulário centrado numa parede vazia: a única tela do produto
   que não mostrava o produto. Quem chegava por um link do Discord via o nome do
   app, dois botões e nada do que o clube tinha feito — e a coisa mais
   convincente que este produto tem é justamente o acervo dele.

   Então a porta virou uma sala com alguma coisa dentro. À esquerda a frase e as
   duas chaves; à direita as FICHAS EM DESTAQUE, que são filmes de verdade,
   avaliados de verdade, com a nota que o clube deu.

   Saem do CINECLUBE, que é a sala em que toda conta nasce e a única coisa que
   esta tela pode prometer a quem ainda não entrou: ele é público, e num clube
   público o acervo é lido de fora, inclusive deslogado. Vinham de uma média da
   rede inteira enquanto havia um saguão que a somasse; sem ele, uma "nota da
   rede" seria um número sem tela que o explique.

   O formulário não virou uma segunda tela: ele ocupa a coluna da esquerda no
   lugar da frase. Quem clicou em "entrar" já decidiu, e as fichas continuam ali
   ao lado enquanto ele digita.

   Duas portas para a mesma conta. O Google é a normal; a senha existe para a
   porta não ser única, e é o que garante que ninguém perca o clube por um
   motivo que não tem nada a ver com o clube.
   ══════════════════════════════════════════════════════════════════════════ */

/** O erro que a volta do Google escreve no endereço, se houver. */
function errorFromHash() {
  const raw = (location.hash || '').replace(/^#/, '');
  const q = raw.indexOf('?');
  if (q < 0) return null;
  const got = new URLSearchParams(raw.slice(q + 1)).get('erro');
  return got || null;
}

/** Um filme que a rede avaliou, com a nota que ela deu. */
type Ficha = {
  id: number;
  title: string;
  year: number | null;
  poster: string;
  director: string | null;
  average: number;
  takes: number;
};

const MAX_MOSTRA = 3;

/* A sala que esta tela mostra, e a mesma que o app abre sem endereço: toda conta
   nasce dentro dela, e ela é pública, então o acervo é legível por quem ainda
   não entrou. Ver `EnterFirstClub` em App.tsx e `joinHomeClub` no servidor. */
const CLUBE = 'cineclube';

export function SignIn({ onSignedIn }: { onSignedIn: (u: SessionUser) => void }) {
  const [google, setGoogle] = useState(true);
  /* O erro só é escrito no primeiro render, pela volta do Google. Nada nesta
     tela produz um segundo — o formulário de senha tem o seu próprio. */
  const [error] = useState<string | null>(() => errorFromHash());
  /* Qual porta está aberta. Fechada, a coluna da esquerda é o convite. Quem
     voltou do Google com um erro chega com ela aberta: essa pessoa não está
     sendo convidada, está tentando entrar e não conseguiu. */
  const [door, setDoor] = useState<'entrar' | 'criar' | null>(error ? 'entrar' : null);
  /* Pedir o link de volta. É um terceiro estado desta mesma coluna e não uma
     tela nova: quem chegou aqui já digitou o e-mail, e mandá-lo para outro
     lugar seria pedir que digitasse de novo. */
  const [forgot, setForgot] = useState<string | null>(null);
  /* Se esta instalação sabe mandar e-mail. Sem isso "esqueci minha senha" não
     aparece — um botão que não tem como funcionar é pior que a ausência dele. */
  const [canMail, setCanMail] = useState(false);
  /* `null` enquanto o acervo não respondeu: vazio é uma resposta diferente de
     "ainda não sei", e as duas telas são outras. */
  const [fichas, setFichas] = useState<Ficha[] | null>(null);

  /* Se esta instalação sequer tem a porta do Google configurada. Sem as
     variáveis no servidor o botão não aparece: um botão que leva a um 503 é pior
     do que um botão que não está lá. */
  useEffect(() => {
    void auth
      .me()
      .then(r => {
        setGoogle(r.google !== false);
        setCanMail(r.mail === true);
      })
      .catch(() => setGoogle(true));
  }, []);

  /* O acervo cru, agrupado aqui e não no servidor: são as fichas do clube, uma
     por pessoa por filme, e o que a porta mostra é a OBRA — três pessoas que
     avaliaram Parasita são um cartaz com três fichas dentro, não três cartazes.

     Da maior nota para a menor, porque o que o clube mais gostou é a melhor
     coisa que ele tem para mostrar a quem está decidindo se entra. Sem pôster
     não entra: um retângulo vazio numa mão de três cartazes é o buraco onde
     deveria haver filme. */
  useEffect(() => {
    let vivo = true;
    void api<{ reviews: Review[] }>(`/api/c/${CLUBE}/reviews`)
      .then(({ reviews }) => {
        if (!vivo) return;
        const por = new Map<number, Ficha & { soma: number }>();
        for (const r of reviews) {
          if (!r.moviePoster) continue;
          const tem = por.get(r.movieId);
          if (tem) {
            tem.soma += r.final;
            tem.takes += 1;
            tem.average = tem.soma / tem.takes;
            continue;
          }
          por.set(r.movieId, {
            id: r.movieId,
            title: r.movieTitle,
            year: r.movieYear,
            poster: r.moviePoster,
            director: r.movieDirector,
            average: r.final,
            soma: r.final,
            takes: 1,
          });
        }
        setFichas(
          [...por.values()]
            .sort((a, b) => b.average - a.average)
            .slice(0, MAX_MOSTRA)
            .map(({ soma: _soma, ...f }) => f)
        );
      })
      .catch(() => setFichas([]));
    return () => {
      vivo = false;
    };
  }, []);

  /* O erro veio no endereço e já foi lido. Limpar evita que ele reapareça a cada
     recarga de uma aba que ficou aberta com o endereço sujo. */
  useEffect(() => {
    if (errorFromHash()) history.replaceState(null, '', location.pathname + '#entrar');
  }, []);

  function abrir(qual: 'entrar' | 'criar') {
    setForgot(null);
    setDoor(qual);
  }

  /* Enquanto o acervo não respondeu a coluna existe com as celas vazias, para a
     página não pular quando os cartazes chegarem. Se o clube não avaliou nada,
     ela deixa de existir e a frase fica sozinha no meio: melhor uma coluna a
     menos do que três buracos onde deveria haver filme. */
  const mostra = fichas === null || fichas.length > 0;

  return (
    <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] flex-col overflow-x-hidden">
      <HolographicWall asBackdrop />

      <div className="relative z-[1] flex flex-1 flex-col">
        <header className="mx-auto flex w-full max-w-[1240px] items-center justify-between gap-6 px-5 py-5 lg:px-6 lg:py-6">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-[30px] leading-none tracking-[0.16em] text-beam sm:text-[38px]">
              CINECLUBE
            </span>
            {/* A lâmpada de gravação, no lugar em que ela fica numa sala: acesa,
                e respirando. É a primeira coisa desta página que se mexe. */}
            <span
              aria-hidden
              className="inline-block h-[7px] w-[7px] flex-none animate-lamp rounded-full bg-dye-red shadow-[0_0_10px_rgba(242,86,74,0.85)]"
            />
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <Key tone="ghost" onClick={() => abrir('entrar')}>
              Entrar
            </Key>
            <Key tone="commit" onClick={() => abrir('criar')}>
              Criar conta
            </Key>
          </div>
        </header>

        <section
          className={cn(
            'mx-auto grid w-full max-w-[1240px] flex-1 items-center gap-10 px-5 py-8 lg:gap-14 lg:px-6 lg:py-10',
            mostra
              ? 'grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))]'
              : 'max-w-[760px] grid-cols-1'
          )}
        >
          <div className="min-w-0">
            <AnimatePresence initial={false} mode="wait">
              {door === null ? (
                <motion.div
                  key="convite"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Convite
                    google={google}
                    onCriar={() => abrir('criar')}
                    onEntrar={() => abrir('entrar')}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="porta"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Porta
                    mode={door}
                    onMode={setDoor}
                    google={google}
                    canMail={canMail}
                    error={error}
                    forgot={forgot}
                    onForgot={setForgot}
                    onSignedIn={onSignedIn}
                    onClose={() => {
                      setForgot(null);
                      setDoor(null);
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {mostra ? <Mostra fichas={fichas} /> : null}
        </section>

        <footer className="border-t border-white/[0.06]">
          <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-4 px-5 py-5 lg:px-6 lg:py-6">
            <span className="legend text-[11px]">Cineclube · para quem fica até os créditos</span>
            <span className="text-[10.5px] text-ink-dim">Imagens e catálogo: TMDB</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ── o convite ────────────────────────────────────────────────────────────
   O que a página diz antes de pedir qualquer coisa. Duas chaves do mesmo
   tamanho e não um botão de marca com um formulário de consolação embaixo. */
function Convite({
  google,
  onCriar,
  onEntrar,
}: {
  google: boolean;
  onCriar: () => void;
  onEntrar: () => void;
}) {
  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <span aria-hidden className="h-px w-[26px] flex-none bg-dye-red" />
        <span className="legend text-[11px]">Sessão privada · seu clube</span>
      </div>

      <h1 className="font-display text-[40px] uppercase leading-[0.92] tracking-[0.04em] text-beam [text-wrap:balance] sm:text-[54px] lg:text-[66px]">
        O filme acaba.
        <br />
        <span className="text-dye-red-lit">A conversa continua.</span>
      </h1>

      {/* "Onze critérios" e não "critérios com peso": os pesos foram igualados
          em 25/08/2026, e a ficha continua tendo onze perguntas. */}
      <p className="mt-6 max-w-[52ch] text-[14px] leading-relaxed text-ink-dim">
        Nada de estrelinha solta. Aqui cada filme passa por onze critérios, cada
        nota fica registrada com quem deu — e a média do clube vira o placar da
        sessão.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Key
          tone="commit"
          onClick={onCriar}
          className="px-6 py-3.5 text-[14px] shadow-[0_0_26px_-6px_rgba(209,42,32,0.8)] transition-shadow hover:shadow-[0_0_34px_-4px_rgba(226,53,42,0.95)]"
        >
          Criar minha conta
        </Key>
        {google ? (
          <a
            href={auth.googleUrl}
            className={cn(
              'inline-flex items-center gap-2.5 rounded-cell px-6 py-3.5 no-underline',
              'bg-house-seat/70 ring-1 ring-house-rail',
              'font-display text-[14px] uppercase leading-none tracking-[0.14em] text-ink',
              'transition-colors duration-150 hover:text-beam hover:ring-beam/70',
              'coarse:min-h-[44px]'
            )}
          >
            <GoogleMark />
            Entrar com Google
          </a>
        ) : (
          <Key tone="flush" onClick={onEntrar} className="px-6 py-3.5 text-[14px]">
            Já tenho conta
          </Key>
        )}
      </div>

      <p className="mt-5 text-[12px] text-ink-dim">
        {google
          ? 'Entrar pelo Google já cria sua conta. O clube vem depois.'
          : 'A conta é sua; o clube vem depois — dá para fundar o seu ou pedir para entrar em um.'}
      </p>
    </>
  );
}

/* ── a porta aberta ───────────────────────────────────────────────────────
   Mesma coluna, mesmo lugar na página. O título continua em Staatliches e na
   altura de uma marquise, porque uma coluna que troca uma manchete por três
   campos de 14px derruba o peso da página inteira para um lado só. */
function Porta({
  mode,
  onMode,
  google,
  canMail,
  error,
  forgot,
  onForgot,
  onSignedIn,
  onClose,
}: {
  mode: 'entrar' | 'criar';
  onMode: (m: 'entrar' | 'criar') => void;
  google: boolean;
  canMail: boolean;
  error: string | null;
  forgot: string | null;
  onForgot: (email: string | null) => void;
  onSignedIn: (u: SessionUser) => void;
  onClose: () => void;
}) {
  const criando = mode === 'criar';
  const pedindo = forgot !== null;

  return (
    <div className="w-full max-w-[420px]">
      <div className="mb-5 flex items-center gap-3">
        <span aria-hidden className="h-px w-[26px] flex-none bg-dye-red" />
        <span className="legend text-[11px]">
          {pedindo ? 'Senha nova' : criando ? 'Criar conta' : 'Entrar'}
        </span>
      </div>

      <h1 className="font-display text-[32px] uppercase leading-[0.95] tracking-[0.04em] text-beam sm:text-[40px]">
        {pedindo ? 'Volte para dentro.' : criando ? 'Puxe uma cadeira.' : 'De volta à sala.'}
      </h1>

      {error ? (
        <div className="mt-5">
          <Fault>{error}</Fault>
        </div>
      ) : null}

      {pedindo ? (
        <ForgotPassword email={forgot} onBack={() => onForgot(null)} />
      ) : (
        <>
          {google ? (
            <>
              <a
                href={auth.googleUrl}
                className={cn(
                  'mt-6 flex w-full items-center justify-center gap-3 rounded-cell px-4 py-3 no-underline',
                  'bg-house-seat/70 ring-1 ring-house-rail',
                  'font-display text-[13px] uppercase leading-none tracking-[0.14em] text-ink',
                  'transition-colors duration-150 hover:text-beam hover:ring-beam/70',
                  'coarse:min-h-[44px]'
                )}
              >
                <GoogleMark />
                {criando ? 'Criar conta com o Google' : 'Entrar com o Google'}
              </a>
              <div className="mt-5 flex items-center gap-3">
                <span aria-hidden className="h-px flex-1 bg-white/[0.07]" />
                <span className="legend text-[10px]">ou</span>
                <span aria-hidden className="h-px flex-1 bg-white/[0.07]" />
              </div>
            </>
          ) : null}

          <PasswordEntry
            mode={mode}
            onMode={onMode}
            onSignedIn={onSignedIn}
            canMail={canMail}
            onForgot={onForgot}
          />
        </>
      )}

      <button
        type="button"
        onClick={onClose}
        className="mt-6 font-display text-[12px] uppercase leading-none tracking-[0.14em] text-ink-faint transition-colors hover:text-beam"
      >
        ← Voltar
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   AS FICHAS EM DESTAQUE.

   Três cartazes na mão, como quem abre um leque: o do meio é o assunto e os
   dois de trás são o resto da mão. Não são enfeite — cada um é um filme que
   alguma sala avaliou e emprestou à rede, com a nota que ela deu, e clicar num
   dos de trás o traz para a frente.

   Tudo se move por transformação e só por transformação: os três são o MESMO
   retângulo, na mesma posição, e o que os separa é rotação, escala e
   deslocamento em porcentagem da própria largura. É o que faz a troca ser uma
   carta voando, e não três caixas sendo remedidas.
   ══════════════════════════════════════════════════════════════════════════ */

/* Da esquerda para a direita. O centro é o índice 1, e a troca é sempre com
   ele: um rodízio circular move as três cartas para responder a um clique em
   uma, e o olho perde qual delas foi escolhida.

   Em porcentagem da própria carta, nunca em pixels — a mão inteira encolhe com
   a coluna, e as distâncias precisam encolher junto. */
const SLOTS = [
  { x: '-106%', y: '8.7%', rotate: -9, scale: 0.879, zIndex: 1, opacity: 0.9 },
  { x: '-50%', y: '0%', rotate: -2, scale: 1, zIndex: 3, opacity: 1 },
  { x: '6%', y: '3.8%', rotate: 8, scale: 0.879, zIndex: 1, opacity: 0.9 },
];

/* Onde a carta vai quando a mão chega perto dela: dois graus mais aberta e um
   palmo acima. Só as de trás — a do meio não leva a lugar nenhum, e um cartaz
   que responde ao ponteiro sem ter para onde ir é uma promessa falsa. */
const HOVER: ({ rotate: number; y: string } | null)[] = [
  { rotate: -11, y: '6.8%' },
  null,
  { rotate: 10, y: '1.9%' },
];

/** Quais posições a mão usa quando tem menos de três cartas. Duas viram centro
    e uma atrás; uma fica sozinha no centro, e não torta na ponta. */
function posicoesDe(n: number) {
  if (n >= 3) return [0, 1, 2];
  if (n === 2) return [0, 1];
  return [1];
}

function Mostra({ fichas }: { fichas: Ficha[] | null }) {
  const quieto = useReducedMotion();

  const carregando = fichas === null;
  const lista = carregando ? [] : fichas.slice(0, MAX_MOSTRA);
  const n = carregando ? MAX_MOSTRA : lista.length;
  const posicoes = posicoesDe(n);
  const meio = posicoes.indexOf(1);

  /* Qual carta está em cada posição da mão. Estado de composição, e por isso
     mora aqui: `SignIn` sabe quais fichas existem, não qual está na frente. */
  const [ordem, setOrdem] = useState<number[]>(() => posicoes.map((_, i) => i));
  useEffect(() => {
    setOrdem(Array.from({ length: n }, (_, i) => i));
  }, [n]);

  const centro = lista[ordem[meio]] ?? lista[0] ?? null;

  function trazer(k: number) {
    if (k === meio) return;
    setOrdem(atual => {
      const prox = [...atual];
      [prox[meio], prox[k]] = [prox[k], prox[meio]];
      return prox;
    });
  }

  return (
    <div className="min-w-0 py-2 lg:py-6">
      <div className="relative mx-auto aspect-[1/0.92] w-full max-w-[560px]">
        {posicoes.map((slot, k) => {
          const ficha = lista[ordem[k]] ?? null;
          const alvo = SLOTS[slot];
          const hover = HOVER[slot];
          const atras = slot !== 1;

          return (
            /* A carta é sempre uma `div`, e o botão mora dentro dela. Trocar a
               tag conforme a posição desmontaria o elemento no meio da troca, e
               a carta pularia para o lugar novo em vez de voar até ele. */
            <motion.div
              key={ficha ? `f${ficha.id}` : `vazia-${k}`}
              className={cn(
                'absolute left-1/2 top-0 aspect-[2/3] w-1/2 overflow-hidden rounded-cell bg-house-deep',
                !ficha &&
                  'bg-[repeating-linear-gradient(135deg,rgba(255,233,196,0.05)_0_6px,transparent_6px_12px)]',
                slot === 1
                  ? 'shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),0_34px_70px_-20px_rgba(0,0,0,0.9),0_0_60px_-18px_rgba(255,233,196,0.4)]'
                  : 'shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),0_24px_50px_-18px_rgba(0,0,0,0.9)]'
              )}
              /* A cela vazia não entra: ela é o lugar guardado enquanto o
                 acervo responde, e uma cela que chega voando anuncia a espera
                 em vez de escondê-la. Quem entra é a carta, quando existe. */
              initial={
                quieto || !ficha ? alvo : { ...alvo, y: '16%', opacity: 0, rotate: alvo.rotate * 0.3 }
              }
              animate={alvo}
              whileHover={quieto || !ficha ? undefined : (hover ?? undefined)}
              transition={
                quieto
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 190, damping: 26, mass: 0.9 }
              }
            >
              {ficha ? (
                <img
                  src={ficha.poster}
                  alt=""
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              ) : null}

              {ficha && atras ? (
                <>
                  {/* A nota fica no canto que sobrou de fora, e cada carta tem
                      o seu: a da esquerda mostra o pé, a da direita mostra a
                      cabeça — o pé dela é onde a placa da média está. */}
                  <span
                    aria-hidden
                    className={cn(
                      'pointer-events-none absolute inset-x-0 h-1/3',
                      slot === 0
                        ? 'bottom-0 bg-gradient-to-t from-house-deep/90 to-transparent'
                        : 'top-0 bg-gradient-to-b from-house-deep/90 to-transparent'
                    )}
                  />
                  <span
                    aria-hidden
                    className={cn(
                      'q pointer-events-none absolute font-display text-[17px] leading-none text-dye-brass sm:text-[19px]',
                      slot === 0 ? 'bottom-2.5 left-2.5' : 'right-2.5 top-2.5'
                    )}
                  >
                    {fmt(ficha.average)}
                  </span>
                  {/* O anel de foco entra para dentro: a carta corta o que
                      passa da borda dela, e um anel de fora sumiria. */}
                  <button
                    type="button"
                    onClick={() => trazer(k)}
                    aria-label={`Pôr ${ficha.title} em destaque — nota ${fmt(ficha.average)}`}
                    className="absolute inset-0 cursor-pointer focus-visible:outline-offset-[-4px]"
                  />
                </>
              ) : null}
            </motion.div>
          );
        })}

        {/* A placa: a nota, do tamanho de uma nota. Fica sobre a mão e não
            dentro de um cartaz porque ela não é sobre a imagem — é o que a sala
            escreveu depois de ver o filme. */}
        {centro ? (
          <motion.div
            key={`placa-${centro.id}`}
            initial={quieto ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="absolute bottom-[8%] right-[2%] z-[4] flex rotate-[-3deg] items-center gap-3 rounded-plate bg-house-seat px-4 py-3 shadow-[inset_0_0_0_1px_rgba(217,164,65,0.4),0_18px_40px_-16px_rgba(0,0,0,0.95)]"
          >
            <span className="q font-display text-[32px] leading-none text-beam sm:text-[38px]">
              {fmt(centro.average)}
            </span>
            {/* Uma ficha só não é média de nada. A placa diz o que o número de
                fato é nos dois casos. */}
            <span className="font-display text-[11px] uppercase leading-[1.5] tracking-[0.12em] text-dye-brass">
              {centro.takes > 1 ? 'Média' : 'Nota'}
              <br />
              do clube
            </span>
          </motion.div>
        ) : null}
      </div>

      {/* A legenda da mão. Um filme, quem dirigiu, quando, e quantas fichas ele
          já tem — que é a única coisa aqui que não é do TMDB. */}
      <div
        aria-live="polite"
        className="mx-auto mt-6 flex min-h-[72px] max-w-[560px] items-end justify-between gap-4 border-t border-white/[0.06] pt-4"
      >
        {centro ? (
          <motion.div
            key={`legenda-${centro.id}`}
            initial={quieto ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="flex min-w-0 flex-1 items-end justify-between gap-4"
          >
            <div className="min-w-0">
              <div className="legend text-[11px]">Ficha em destaque</div>
              <div className="mt-2 truncate font-display text-[24px] uppercase leading-[1.15] tracking-[0.03em] text-beam sm:text-[28px]">
                {centro.title}
              </div>
              <div className="mt-1 truncate text-[11.5px] text-ink-dim">
                {[centro.director, centro.year].filter(Boolean).join(' · ')}
              </div>
            </div>
            <span className="flex flex-none items-center gap-2 font-display text-[12px] uppercase tracking-[0.12em] text-dye-green-lit">
              <span
                aria-hidden
                className="inline-block h-[6px] w-[6px] rounded-full bg-dye-green shadow-[0_0_10px_rgba(47,158,68,0.9)]"
              />
              {plural(centro.takes, 'ficha gravada', 'fichas gravadas')}
            </span>
          </motion.div>
        ) : (
          <div className="legend text-[11px]">Abrindo o acervo</div>
        )}
      </div>
    </div>
  );
}

/* ── e-mail e senha ───────────────────────────────────────────────────────
   Uma frase só de erro para senha errada e para e-mail que não existe, porque o
   servidor também responde uma só: um formulário que distingue os dois casos é
   um jeito de descobrir quem tem conta aqui. */
function PasswordEntry({
  mode,
  onMode,
  onSignedIn,
  canMail,
  onForgot,
}: {
  mode: 'entrar' | 'criar';
  onMode: (m: 'entrar' | 'criar') => void;
  onSignedIn: (u: SessionUser) => void;
  /** Esta instalação sabe mandar e-mail. Sem isso, não há o que oferecer. */
  canMail: boolean;
  /** Leva o e-mail já digitado junto, para não pedir que seja escrito de novo. */
  onForgot: (email: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  const criando = mode === 'criar';

  useEffect(() => {
    first.current?.focus();
  }, [criando]);

  const curta = criando && password.length > 0 && password.length < 8;
  const pronto = criando
    ? !!name.trim() && !!email.trim() && password.length >= 8
    : !!email.trim() && !!password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !pronto) return;
    setBusy(true);
    setError(null);
    try {
      const { reviewer } = criando
        ? await auth.register(name.trim(), email.trim(), password)
        : await auth.login(email.trim(), password);
      onSignedIn(reviewer);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
      {/* O nome vem primeiro porque é a única pergunta sobre a pessoa; o resto
          é credencial. Só existe ao criar — entrar não precisa saber quem você
          diz que é, precisa saber quem você prova ser. */}
      {criando ? (
        <Field
          ref={first}
          label="Como te chamam"
          autoComplete="name"
          maxLength={60}
          value={name}
          onChange={setName}
        />
      ) : null}
      <Field
        ref={criando ? undefined : first}
        label="E-mail"
        type="email"
        autoComplete="username"
        value={email}
        onChange={setEmail}
      />
      <Field
        label="Senha"
        type="password"
        autoComplete={criando ? 'new-password' : 'current-password'}
        value={password}
        onChange={setPassword}
        hint={criando ? 'Pelo menos 8 caracteres.' : undefined}
        bad={curta}
      />

      {error ? <Fault>{error}</Fault> : null}

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Key tone="commit" type="submit" disabled={busy || !pronto}>
          {busy ? (criando ? 'Criando' : 'Entrando') : criando ? 'Criar conta' : 'Entrar'}
        </Key>
        {/* Troca de modo sem perder o que já foi digitado: quem errou a porta
            não deveria redigitar o e-mail que acabou de escrever. */}
        <Key
          tone="ghost"
          onClick={() => {
            setError(null);
            onMode(criando ? 'entrar' : 'criar');
          }}
        >
          {criando ? 'Já tenho conta' : 'Criar uma conta'}
        </Key>
      </div>

      {/* Só ao entrar, e só se esta instalação sabe mandar e-mail. Num
          formulário de criar conta ele não quer dizer nada, e sem envio
          configurado seria um botão que não tem como funcionar. */}
      {!criando && canMail ? (
        <button
          type="button"
          onClick={() => onForgot(email.trim())}
          className="mt-1 self-start text-[12.5px] text-ink-faint underline underline-offset-4 transition-colors hover:text-ink"
        >
          Esqueci minha senha
        </button>
      ) : null}
    </form>
  );
}

/* A tela responde a mesma coisa exista a conta ou não, e a frase diz isso em voz
   alta em vez de fingir sucesso: "se existir uma conta com esse endereço".
   Fingir que mandou seria mentir para quem digitou o e-mail errado — o caso
   comum —, e essa pessoa ficaria esperando uma mensagem que nunca vem.

   O servidor faz o mesmo, e lá é uma regra de segurança: uma resposta diferente
   transformaria a rota numa lista de quem tem conta aqui. */
function ForgotPassword({ email: inicial, onBack }: { email: string; onBack: () => void }) {
  const [email, setEmail] = useState(inicial);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await auth.requestReset(email.trim());
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="mt-5">
        <p className="text-[13.5px] leading-relaxed text-ink">
          Se existir uma conta com <span className="text-beam">{email.trim()}</span>, o link já
          está a caminho.
        </p>
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-dim">
          Ele vale por uma hora e só funciona uma vez. Se não chegar em alguns
          minutos, olhe no spam.
        </p>
        <div className="mt-5">
          <Key tone="ghost" onClick={onBack}>
            Voltar
          </Key>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
      <p className="text-[12.5px] leading-relaxed text-ink-dim">
        Digite o e-mail da sua conta. Mandamos um link para você escolher uma
        senha nova.
      </p>
      <Field ref={first} label="E-mail" type="email" autoComplete="username" value={email} onChange={setEmail} />
      {error ? <Fault>{error}</Fault> : null}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Key tone="commit" type="submit" disabled={busy || !email.trim()}>
          {busy ? 'Mandando' : 'Mandar o link'}
        </Key>
        <Key tone="ghost" onClick={onBack}>
          Voltar
        </Key>
      </div>
    </form>
  );
}

/* Aparece depois do Google e antes do clube, e é a única coisa entre a pessoa
   e o produto — então ela diz por que existe. Um formulário que pede uma senha
   sem explicar por quê, logo depois de a pessoa ter provado quem é, parece
   trabalho repetido.

   Dá para pular: é um seguro, e um seguro obrigatório na porta de entrada é um
   pedágio. Quem pular volta a ver o convite, porque o motivo dele não expira. */
export function SetPassword({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  const short = password.length > 0 && password.length < 8;
  const mismatch = again.length > 0 && again !== password;
  const ready = password.length >= 8 && again === password && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await auth.setPassword(password);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] flex-col">
      <HolographicWall asBackdrop />
      <div className="relative mx-auto flex w-full max-w-[900px] flex-1 flex-col justify-center px-5 py-14">
        <header className="mb-8 text-center">
          <h1 className="font-display text-[34px] leading-none tracking-[0.06em] text-beam">
            Guarde uma segunda chave
          </h1>
          <p className="mx-auto mt-4 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-dim">
            Você entrou pelo Google, e isso basta para hoje. Uma senha é o
            caminho de volta no dia em que aquela conta não estiver mais à mão —
            e o clube não é uma coisa que se possa perder por causa dela.
          </p>
        </header>

        <form onSubmit={submit} className="mx-auto flex w-full max-w-[380px] flex-col gap-3">
          <Field
            ref={first}
            label="Nova senha"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            hint="Pelo menos 8 caracteres."
            bad={short}
          />
          <Field
            label="De novo"
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={setAgain}
            hint={mismatch ? 'As duas não batem.' : undefined}
            bad={mismatch}
          />

          {error ? <Fault>{error}</Fault> : null}

          <div className="mt-1 flex items-center gap-2">
            <Key tone="commit" type="submit" disabled={!ready}>
              {busy ? 'Gravando' : 'Gravar senha'}
            </Key>
            <Key tone="ghost" onClick={onSkip}>
              Agora não
            </Key>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── um campo ─────────────────────────────────────────────────────────────
   Recuado na sala, como todo campo deste produto: fundo `house-deep`, anel
   `house-rail`, cantos de 2px e o cursor vermelho — a única aparição de vermelho
   em repouso no sistema, porque um cursor é uma cabeça de gravação. */
type FieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  bad?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>;

const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, value, onChange, hint, bad, ...rest },
  ref
) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="legend text-[10px]">{label}</span>
      <input
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        {...rest}
        className={cn(
          'w-full rounded-cell bg-house-deep px-3 py-2.5 text-[14px] text-ink caret-dye-red',
          'ring-1 transition-shadow placeholder:text-ink-dim',
          'focus-visible:outline-none focus-visible:ring-dye-brass',
          bad ? 'ring-dye-red-lit/60' : 'ring-house-rail',
          rest.className
        )}
      />
      {hint ? (
        <span className={cn('text-[12px]', bad ? 'text-dye-red-lit' : 'text-ink-faint')}>{hint}</span>
      ) : null}
    </label>
  );
});

/* A marca do Google, desenhada e não uma fonte de ícone: é a única coisa neste
   produto que pertence a outra pessoa, e ela tem uma forma exata. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="h-[18px] w-[18px] flex-none">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59A14.5 14.5 0 0 1 9.77 24c0-1.6.28-3.14.76-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.88.93 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
