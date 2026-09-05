const express = require('express');
const throttle = require('../throttle');

const router = express.Router();

/* ══════════════════════════════════════════════════════════════════════════
   O que a política teria bloqueado.

   Enquanto a CSP roda em modo aviso, é aqui que ela conta o que encontrou no
   navegador das pessoas do clube — que é o único lugar onde uma política de
   conteúdo pode ser conferida de verdade. Ler os arquivos publicados diz o que
   a página REFERENCIA; só o navegador diz o que ela CARREGA.

   ── um endpoint de aviso é um alvo ────────────────────────────────────────
   Ele aceita corpo de qualquer um, sem sessão, e escreve em log. Sem cuidado
   isso é um jeito de encher o log da instância a partir de fora — e o log é o
   instrumento com que se lê tudo o mais. Três coisas o seguram:

   1. **Uma trava própria**, por endereço, mais apertada que a da API. Um
      navegador manda um punhado de avisos ao abrir a página e para.
   2. **Repetido não escreve de novo.** A chave é "diretiva + o que foi
      recusado": uma parede que falta produz o mesmo aviso em toda tela, e o
      décimo não ensina nada que o primeiro não tenha ensinado.
   3. **Só os campos que interessam**, cortados. O corpo é escrito pelo
      navegador, mas quem faz a requisição escolhe o corpo — então nada dele vai
      inteiro para o log.

   ── e por que ele não guarda nada ─────────────────────────────────────────
   Sem tabela. Isto existe para uma travessia — medir a política, corrigi-la,
   e ligar o modo de verdade —, e uma tabela criada para uma travessia é uma
   tabela que fica. O log do Render é onde isto é lido, e some com o mesmo
   ciclo de vida do problema que ele descreve.
   ══════════════════════════════════════════════════════════════════════════ */

const vistos = new Set();
/* Um teto para o próprio Set, ou ele vira a memória que ele deveria poupar. */
const MAX_VISTOS = 500;

const corte = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

router.post(
  '/',
  // Um `type` que aceita qualquer coisa, porque o navegador manda
  // `application/csp-report` — que o `express.json()` global não reconhece e
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

    /* ── o que estava escrito lá dentro ────────────────────────────────────
       Para um script inline o `blocked-uri` é a palavra "inline", e só. Isso
       diz que ALGUM script inline seria recusado e não diz qual — que foi
       exatamente o buraco na primeira leitura destes avisos em produção: os
       dois scripts do nosso HTML batiam com os hashes, então o recusado era um
       terceiro, e a linha do log não tinha como dizer de onde ele veio.

       O navegador manda um trecho do começo dele em `script-sample`. Quarenta
       caracteres bastam para reconhecer se aquilo é código nosso, de uma
       extensão do navegador ou de outra coisa. Cortado aqui de qualquer jeito:
       o corpo é escrito pelo navegador, mas quem faz a requisição escolhe o
       corpo. `source-file` e a linha completam, quando vêm.

       As quebras de linha viram espaço para o aviso não virar cinco linhas de
       log a partir de conteúdo que veio de fora. */
    const sample = corte(
      String(r['script-sample'] || r.sample || '').replace(/\s+/g, ' ').trim(),
      120
    );
    const source = corte(r['source-file'] || r.sourceFile, 160);

    const line = Number.isFinite(Number(r['line-number'])) ? Number(r['line-number']) : null;

    /* ── o lugar entra na chave, e isso não é detalhe ──────────────────────
       A chave era diretiva + origem recusada. Para script inline os dois são
       sempre "script-src-elem" e "inline", então DOIS scripts diferentes do
       mesmo documento colapsavam numa linha só — e foi o que aconteceu na
       primeira leitura em produção: os dois estavam sendo recusados e o log
       mostrava um, o que fez parecer que só havia um problema.

       Com o arquivo e a linha dentro, cada script recusado aparece uma vez. Um
       aviso repetido continua não repetindo, que é o que se queria. */
    const chave = `${directive}|${blocked}|${source}|${line}|${sample}`;

    if (!vistos.has(chave)) {
      if (vistos.size >= MAX_VISTOS) vistos.clear();
      vistos.add(chave);
      /* ASCII na seta de propósito: esta linha é lida num painel de log, e
         alguns deles ainda entregam bytes que o terminal de quem lê interpreta
         como latin-1. Um aviso que chega embaralhado é um aviso pela metade. */
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
