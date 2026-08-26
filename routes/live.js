const express = require('express');
const auth = require('../auth');
const live = require('../live');

const router = express.Router();

/* ── o cano ───────────────────────────────────────────────────────────────
   Os cabeçalhos são todos funcionais, e são os mesmos da sala de projeção pelo
   mesmo motivo: `no-transform` e `X-Accel-Buffering` impedem um intermediário
   de segurar quadros para encher um buffer, o que neste endpoint significa
   segurar um aviso até a pessoa recarregar a página — que é exatamente o
   problema que ele veio resolver. `flushHeaders` manda tudo antes de existir o
   primeiro quadro, que é o que faz o navegador considerar a conexão aberta.

   Precisa de sessão. Não porque o que trafega seja secreto — não trafega nada
   além de uma palavra — mas porque uma conexão aberta é um recurso, e as
   abertas devem ser todas de gente do clube. */
router.get('/stream', auth.requireSession, (req, res) => {
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
  const entry = live.subscribe(res, req.session.reviewer_id);

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
