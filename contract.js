/* ══════════════════════════════════════════════════════════════════════════
   O CONTRATO DA API, e por que ele passa a existir.

   Enquanto o cliente é o site, não há contrato nenhum a manter: o mesmo deploy
   troca o servidor e a tela juntos, e um campo renomeado nasce e morre no mesmo
   commit. Um aplicativo instalado quebra essa simetria — quem baixou em março
   continua com a tela de março, e uma resposta que perde um campo vira tela em
   branco no aparelho de alguém que não fez nada de errado.

   Então duas regras, e uma delas é executável:

   1. **A API só cresce.** Campo não se remove, não se renomeia e não muda de
      tipo; nulo continua podendo ser nulo. Coisa nova entra como campo novo, e
      um cliente antigo simplesmente não o lê. Quem segura isso são os testes de
      contrato em test/contract.test.js: eles congelam os nomes das respostas
      que um aplicativo lê, e uma remoção falha antes de virar release.

   2. **O cliente sabe o que ele fala.** `VERSION` sobe quando a API ganha
      alguma coisa; `MIN_CLIENT` sobe só quando uma versão antiga REALMENTE não
      funciona mais — e subir isso é dizer a quem não atualizou que o app parou.
      Um aplicativo lê `/api/meta` na abertura e compara com o que ele é.

   O cabeçalho vai em toda resposta de `/api` porque o cliente que precisa dele
   pode não ser o que chamou `/api/meta`: uma resposta que já diz de que versão
   veio dispensa uma requisição inteira para descobrir isso.
   ══════════════════════════════════════════════════════════════════════════ */

/** Sobe a cada acréscimo na API. Nunca desce, e nunca é reaproveitada. */
const VERSION = 1;

/* A versão mais antiga de aplicativo que esta API ainda atende. Subir isto
   DERRUBA quem está abaixo, então só sobe junto com uma mudança que não tem
   como ser aditiva — e o app avisa a pessoa em vez de quebrar calado. */
const MIN_CLIENT = 1;

function middleware() {
  return function contract(req, res, next) {
    res.setHeader('X-API-Version', String(VERSION));
    next();
  };
}

/** O que um cliente instalado pergunta antes de confiar no resto. */
function meta(_req, res) {
  res.json({ api: VERSION, minClient: MIN_CLIENT });
}

module.exports = { VERSION, MIN_CLIENT, middleware, meta };
