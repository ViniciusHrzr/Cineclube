import { createContext, useContext } from 'react';
import type { CommentLike, Reviewer, SessionUser, TakeComment, TakeVote } from '@/lib/api';

export type TakeRef = {
  id: string;
  reviewerId: string;
  reviewerName: string;
};

export type World = {
  me: SessionUser;
  reviewers: Reviewer[];
  comments: TakeComment[];
  votes: TakeVote[];
  commentLikes: CommentLike[];
  comment: (takeId: string, body: string, parentId?: string | null) => Promise<void>;
  uncomment: (id: string) => Promise<void>;
  likeComment: (id: string, liked: boolean) => Promise<void>;
  voteOn: (takeId: string, value: 1 | -1 | 0) => Promise<void>;
  avatarOf: (reviewerId: string) => string | null;
  goPerson: (reviewerId?: string | null) => void;
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
