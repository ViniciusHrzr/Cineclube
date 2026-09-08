const express = require('express');
const auth = require('../auth');
const clubs = require('../clubs');
const live = require('../live');

const router = express.Router({ mergeParams: true });

/* Os cabeçalhos são funcionais: `no-transform` e `X-Accel-Buffering` impedem um
   intermediário de segurar quadros para encher um buffer, o que aqui significa
   segurar um aviso até a pessoa recarregar a página. `flushHeaders` manda tudo
   antes do primeiro quadro, que é o que faz o navegador considerar a conexão
   aberta.

   Sessão E ser membro: a conexão pertence a uma sala, e o que trafega nela não
   é inócuo — um aviso de `social` diz "alguém escreveu alguma coisa agora", e
   num clube privado saber que há gente ativa lá dentro já é mais do que quem
   está de fora tem direito de saber. O pareamento acontece no `emit` de
   live.js; isto é a metade que carimba a conexão. */
router.get('/stream', auth.requireSession, clubs.requireMember, (req, res) => {
  if (!live.canSubscribe(req.session.reviewer_id)) {
    return res.status(429).json({ error: 'Conexões demais. Feche outras abas do Cineclube.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  // Sem isto o timeout de ocioso do socket mata uma conexão cujo trabalho
  // inteiro é ficar ociosa entre um aviso e o próximo.
  req.socket.setTimeout(0);
  req.socket.setNoDelay?.(true);

  live.startTimers();
  const entry = live.subscribe(res, req.session.reviewer_id, req.club.id);

  let gone = false;
  const leave = () => {
    if (gone) return;
    gone = true;
    live.unsubscribe(entry);
  };
  // Os dois, porque uma conexão derrubada e uma resposta fechada nem sempre
  // chegam como o mesmo evento.
  req.on('close', leave);
  res.on('close', leave);
});

module.exports = router;
