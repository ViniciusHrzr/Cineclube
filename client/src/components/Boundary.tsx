import { Component, type ErrorInfo, type ReactNode } from 'react';

/* ══════════════════════════════════════════════════════════════════════════
   The last thing standing.

   React 18 unmounts the whole tree when a render throws and nothing catches
   it. What the club sees then is not an error — it is the app *gone*, a white
   page with no way back except reloading and no clue what happened. That is
   the worst possible failure mode for a bug report: the one person who saw it
   has nothing to tell.

   This turns that into a sentence. It cannot fix anything, and it does not try
   to resume — a tree that threw during render is not in a state worth
   continuing from. It says what broke, where, and offers the reload.
   ══════════════════════════════════════════════════════════════════════════ */
export class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The console keeps the stack the screen has no room for.
    console.error('[cineclube] a tela quebrou:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-[62ch] flex-col justify-center gap-4 px-6">
        <span className="font-display text-[28px] leading-none tracking-[0.04em] text-beam">
          O projetor travou
        </span>
        <p className="text-[13.5px] leading-relaxed text-ink-dim">
          Alguma coisa quebrou no meio da tela. Recarregar resolve; se voltar a acontecer, o texto abaixo é o
          que diz o porquê.
        </p>
        <pre className="q max-h-[40vh] overflow-auto rounded-cell bg-dye-red/10 px-4 py-3 text-[11.5px] leading-relaxed text-ink ring-1 ring-dye-red/45">
          {error.message}
          {error.stack ? `\n\n${error.stack}` : ''}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="w-fit rounded-cell px-4 py-2.5 font-display text-[13px] uppercase tracking-[0.14em] text-ink ring-1 ring-house-rail transition-colors hover:text-beam hover:ring-beam"
        >
          Recarregar
        </button>
      </div>
    );
  }
}
