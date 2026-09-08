import { createContext, useContext } from 'react';
import type { CommentLike, Reviewer, SessionUser, TakeComment, TakeVote } from '@/lib/api';

/* ══════════════════════════════════════════════════════════════════════════
   A SALA, VISTA POR QUEM SÓ PRECISA DA CONVERSA.

   As peças sociais liam do contexto grande do universo de filmes, o que as
   prendia a ele — o de séries não tem contexto nenhum, e um segundo
   `ClubContext` seria uma segunda verdade sobre a mesma sala.

   Este é o pedaço que as duas lentes têm em comum, e só ele. As peças não sabem
   em qual estão, o que é exatamente a razão de elas serem as mesmas peças.

   `takeId` e não `reviewId` porque "ficha" é a palavra que serve para as duas —
   a de um filme e a de um episódio. O servidor manda os dois nomes do lado de
   filmes, e daqui para dentro só existe um.
   ══════════════════════════════════════════════════════════════════════════ */

/** O mínimo de uma ficha para reagir a ela: de quem é, e como se chama. */
export type TakeRef = {
  id: string;
  reviewerId: string;
  reviewerName: string;
};

export type World = {
  me: SessionUser;
  /** Quem está na sala. A lista de menção lê daqui. */
  reviewers: Reviewer[];
  comments: TakeComment[];
  votes: TakeVote[];
  commentLikes: CommentLike[];
  comment: (takeId: string, body: string, parentId?: string | null) => Promise<void>;
  uncomment: (id: string) => Promise<void>;
  likeComment: (id: string, liked: boolean) => Promise<void>;
  /** +1, −1, ou 0 para tirar. Repetir o voto que já está posto tira ele. */
  voteOn: (takeId: string, value: 1 | -1 | 0) => Promise<void>;
  avatarOf: (reviewerId: string) => string | null;
  /** Chamado por todo rosto do app. Sem id, abre o seu. */
  goPerson: (reviewerId?: string | null) => void;
  /** O comentário que um aviso apontou: a conversa cresce até ele e o acende. */
  focusComment: string | null;
  clearFocusComment: () => void;
  fault: (msg: string) => void;
};

const WorldContext = createContext<World | null>(null);

export const WorldProvider = WorldContext.Provider;

export function useWorld() {
  const w = useContext(WorldContext);
  if (!w) throw new Error('useWorld precisa estar dentro de um WorldProvider');
  return w;
}
