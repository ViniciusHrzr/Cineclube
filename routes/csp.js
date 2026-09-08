const express = require('express');
const throttle = require('../throttle');

const router = express.Router();

/* ══════════════════════════════════════════════════════════════════════════
   O que a política teria bloqueado, contado pelo navegador das pessoas do
   clube — o único lugar onde uma CSP pode ser conferida de verdade. Ler os
   arquivos publicados diz o que a página REFERENCIA; só o navegador diz o que
   ela CARREGA.

   Um endpoint de aviso é um alvo: aceita corpo de qualquer um, sem sessão, e
   escreve em log. Três coisas o seguram — uma trava própria por endereço, uma
   chave de "já visto" para o mesmo aviso não repetir, e só os campos que
   interessam, cortados (o corpo é escrito pelo navegador, mas quem faz a
   requisição escolhe o corpo).

   Sem tabela: isto existe para uma travessia — medir a política e ligar o modo
   de verdade —, e uma tabela criada para uma travessia é uma tabela que fica.
   ══════════════════════════════════════════════════════════════════════════ */

const vistos = new Set();
/* Um teto para o próprio Set, ou ele vira a memória que ele deveria poupar. */
const MAX_VISTOS = 500;

const corte = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

router.post(
  '/',
  // Um `type` que aceita qualquer coisa, porque o navegador manda
  // `application/csp-report` — que o `express.json()` global não reconhece,
  // deixando o corpo chegar aqui em branco.
  // deixaria o corpo chegar aqui em branco.
  express.json({ type: '*/*', limit: '16kb' }),
  throttle.limit({
    name: 'csp-report',
    max: 30,
    windowMs: 60 * 60_000,
    by: 'ip',
    message: () => 'Avisos demais.',
  }),
  (req, res) => {
    /* Dois formatos, porque houve duas gerações da especificação: `report-uri`
       manda `{ 'csp-report': {...} }` e `report-to` manda uma lista de
       `{ body: {...} }`. Aceitar os dois custa uma linha. */
    const corpo = req.body || {};
    const r = corpo['csp-report'] || corpo.body || corpo;

    const directive = corte(r['violated-directive'] || r.effectiveDirective, 60);
    const blocked = corte(r['blocked-uri'] || r.blockedURL, 200);

    /* Para um script inline o `blocked-uri` é a palavra "inline", e só: diz que
       ALGUM script inline seria recusado e não diz qual. O navegador manda um
       trecho do começo dele em `script-sample`, e quarenta caracteres bastam
       para reconhecer se aquilo é código nosso, de uma extensão ou de outra
       coisa. Cortado de qualquer jeito, e as quebras de linha viram espaço para
       o aviso não virar cinco linhas de log vindas de fora. */
    const sample = corte(
      String(r['script-sample'] || r.sample || '').replace(/\s+/g, ' ').trim(),
      120
    );
    const source = corte(r['source-file'] || r.sourceFile, 160);

    const line = Number.isFinite(Number(r['line-number'])) ? Number(r['line-number']) : null;

    /* O lugar entra na chave, e isso não é detalhe: para script inline a
       diretiva e a origem recusada são sempre as mesmas duas palavras, então
       dois scripts diferentes do mesmo documento colapsavam numa linha só — e
       o log mostrava um problema onde havia dois. */
    const chave = `${directive}|${blocked}|${source}|${line}|${sample}`;

    if (!vistos.has(chave)) {
      if (vistos.size >= MAX_VISTOS) vistos.clear();
      vistos.add(chave);
      /* ASCII na seta de propósito: alguns painéis de log ainda entregam bytes
         que o terminal interpreta como latin-1, e um aviso embaralhado é um
         aviso pela metade. */
      console.warn(
        `[csp] recusaria ${directive || 'algo'} -> ${blocked || 'sem origem'}` +
          ` (em ${corte(r['document-uri'] || r.documentURL, 120) || 'página desconhecida'})` +
          (source ? ` | de ${source}${line !== null ? ':' + line : ''}` : '') +
          (sample ? ` | trecho: ${sample}` : '')
      );
    }

    /* 204 sempre. Um relatório é informação que o navegador oferece; discutir o
       formato dele com um navegador não leva a lugar nenhum. */
    res.status(204).end();
  }
);

module.exports = router;
