import { Reel } from '@/components/bits';
import { initialsOf, reelColor } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useClub } from '@/App';

/* ══════════════════════════════════════════════════════════════════════════
   O ROSTO É UMA PORTA

   Este produto desenhava pessoas em oito lugares — o feed, o acervo nas duas
   visões, a conversa, as respostas, o sino, a régua de divergência, a marquise —
   e em nenhum deles a pessoa era clicável. Um clube inteiro de nomes pintados.

   O perfil não é o que faltava; ISTO é. A página podia existir e continuar
   inalcançável, porque não havia como chegar nela a não ser pelo próprio rosto.
   Duas peças de meia dúzia de linhas cada, usadas em todo lugar, são o que
   transforma o arquivo de um clube numa rede.

   ── por que duas peças e não uma ────────────────────────────────────────
   Porque o retrato e o nome quase nunca são vizinhos no DOM. Numa linha da
   conversa o retrato fica de fora e o nome mora dentro do bloco de texto; numa
   fileira do acervo os dois estão dentro do botão que abre a gaveta. Uma peça
   só, que desenhasse os dois juntos, obrigaria toda tela a se reorganizar em
   volta dela — e algumas delas acabaram de ser reorganizadas.

   ── o retrato é mudo para quem lê por áudio ─────────────────────────────
   Os dois levam ao mesmo lugar, e anunciar duas vezes "abrir o perfil de Beren"
   é dizer a mesma frase seguida em cada comentário da tela. O retrato é o alvo
   do mouse; o nome é o link de verdade, e é ele que o teclado alcança e o leitor
   de tela lê.

   É a mesma decisão que a seta da gaveta no acervo já tinha tomado, pelo mesmo
   motivo — ver `DrawerArrow` em screens/Reviews.tsx.

   ── nunca dentro de outro botão ─────────────────────────────────────────
   Um `<button>` dentro de outro não é uma coisa que o navegador monte. Onde o
   rosto morava dentro de um controle — a placa do feed, as fileiras do acervo —
   a linha da pessoa foi puxada para FORA e virou irmã dele. É a mesma cirurgia
   que a barra de ação do feed já tinha exigido, e ela é o preço real desta
   costura.
   ══════════════════════════════════════════════════════════════════════════ */

type Person = {
  id: string;
  name: string;
  dot?: string | null;
};

/* Um painel que precisa se fechar antes de a página mudar por baixo dele — o
   sino é o caso. Sem isto ele fica aberto sobre o perfil recém-aberto, ancorado
   a um sino que agora fala de outra tela. */
type Leaves = { onNavigate?: () => void };

/* ── o retrato, clicável ──────────────────────────────────────────────────
   Em duas formas, e a diferença entre elas é de acessibilidade e não de
   aparência.

   **Acompanhado** (o padrão): há um `PersonName` ao lado, e ele é o link de
   verdade. O retrato é só o alvo do mouse — `aria-hidden`, fora da ordem de
   foco —, porque anunciar dois links para o mesmo lugar é dizer a mesma frase
   duas vezes seguidas em cada linha da tela. É a decisão que a seta da gaveta
   do acervo já tinha tomado, pelo mesmo motivo.

   **`solo`**: não existe nome clicável por perto, porque ele mora dentro do
   botão que abre outra coisa — o caso das fileiras do acervo e das linhas do
   sino. Ali o retrato é a ÚNICA porta, e um `aria-hidden` faria dela uma porta
   só para quem usa mouse: teclado e leitor de tela não teriam caminho nenhum
   até o perfil daquela pessoa. Nesses lugares ele é um botão de verdade, com a
   frase inteira no rótulo.

   O canto de 1px é o do próprio carretel — sem ele o anel de foco de latão
   desenharia um retângulo de canto reto por fora de uma etiqueta que tem
   canto. */
export function PersonReel({
  person,
  size = 'sm',
  className,
  solo,
  onNavigate,
}: {
  person: Person;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Marque quando este retrato for o único caminho até o perfil. */
  solo?: boolean;
} & Leaves) {
  const club = useClub();
  /* A parada é o ponto. Estes retratos ficam dentro de fileiras que abrem outra
     coisa — uma ficha, um comentário —, e sem isto o clique faria as duas: iria
     ao perfil e abriria a gaveta atrás dele. */
  const go = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onNavigate?.();
    club.goPerson(person.id);
  };

  const face = (
    <Reel color={reelColor(person.dot, person.id)} src={club.avatarOf(person.id)} size={size}>
      {initialsOf(person.name)}
    </Reel>
  );

  if (solo) {
    return (
      <button
        type="button"
        onClick={go}
        aria-label={`Abrir o perfil de ${person.name}`}
        className={cn('flex flex-none rounded-[1px]', className)}
      >
        {face}
      </button>
    );
  }

  return (
    <span aria-hidden onClick={go} className={cn('flex flex-none cursor-pointer', className)}>
      {face}
    </span>
  );
}

/* O nome, clicável — e o link de verdade desta dupla.

   Sem sublinhado no repouso: estes nomes moram dentro de frases e dentro de
   fileiras densas, e um sublinhado em cada um encheria a tela de traços. O
   facho no hover e no foco é o que este mundo usa para dizer "isto responde",
   e o anel de foco de latão continua sendo desenhado pelo sistema. */
export function PersonName({
  person,
  className,
  onNavigate,
}: {
  person: Person;
  className?: string;
} & Leaves) {
  const club = useClub();
  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation();
        onNavigate?.();
        club.goPerson(person.id);
      }}
      className={cn('rounded-cell text-left transition-colors hover:text-beam', className)}
    >
      {person.name}
    </button>
  );
}
