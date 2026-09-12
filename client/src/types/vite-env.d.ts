/* Os tipos que o Vite injeta — `import.meta.env`, e os módulos de `?url` e
   `?raw`. Um arquivo de referência e nada mais: sem ele, ler uma variável de
   ambiente no cliente é um erro de tipo.

   A que este projeto usa é `VITE_API_BASE`, e ela existe para um pacote de
   aplicativo dizer onde a API mora — ver lib/session.ts. */
/// <reference types="vite/client" />
