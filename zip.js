const { deflateRawSync, crc32 } = require('node:zlib');

/* ══════════════════════════════════════════════════════════════════════════
   UM ZIP, ESCRITO À MÃO.

   Existe por uma razão só: o aplicativo baixa o cliente novo como um zip, e o
   cliente novo é a pasta `public/` que este servidor já serve. Zipar na hora é
   o que faz o pacote ser SEMPRE exatamente o que foi publicado — sem um
   artefato a mais no repositório, sem um passo de build que alguém esquece.

   Node comprime (`zlib`) e não empacota: zip é um formato de contêiner, e o que
   falta é a contabilidade em volta dos bytes comprimidos. São três pedaços:

   1. um cabeçalho local antes de cada arquivo;
   2. um diretório central repetindo os mesmos dados no fim;
   3. um registro de fim apontando para onde o diretório começa.

   ── e por que sem descritor de dados ─────────────────────────────────────
   O formato permite escrever o tamanho DEPOIS do conteúdo, num descritor, para
   quem comprime em fluxo e não sabe o tamanho de antemão. Aqui se sabe: o
   arquivo inteiro está na memória antes de ser comprimido. Isso importa porque
   quem abre este zip é o `ZipInputStream` do Java, dentro do Android, e ele lê
   em fluxo — com o tamanho no cabeçalho ele nunca precisa voltar atrás.

   Sem ZIP64 e sem senha: o pacote é um megabyte de JavaScript.
   ══════════════════════════════════════════════════════════════════════════ */

/** Data e hora no formato do MS-DOS, que é o que o zip guarda. */
function dosTime(at) {
  const d = new Date(at);
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { hora, dia };
}

/**
 * @param {{name: string, data: Buffer, at?: number}[]} files
 * @returns {Buffer} o arquivo zip inteiro
 */
function zip(files, at = Date.now()) {
  const { hora, dia } = dosTime(at);
  const locais = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nome = Buffer.from(file.name, 'utf8');
    const cru = file.data;
    const comprimido = deflateRawSync(cru, { level: 9 });
    /* Guardado sem comprimir quando comprimir não ajuda: é o caso de um PNG,
       que já é deflate por dentro, e um zip maior que o original é um pacote
       que custa mais para baixar por nada. Método 0 é "armazenado". */
    const usaDeflate = comprimido.length < cru.length;
    const corpo = usaDeflate ? comprimido : cru;
    const soma = crc32(cru);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão mínima para extrair: 2.0
    local.writeUInt16LE(0x800, 6); // o nome está em UTF-8
    local.writeUInt16LE(usaDeflate ? 8 : 0, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(soma, 14);
    local.writeUInt32LE(corpo.length, 18);
    local.writeUInt32LE(cru.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28); // sem campo extra

    locais.push(local, nome, corpo);

    const entrada = Buffer.alloc(46);
    entrada.writeUInt32LE(0x02014b50, 0);
    entrada.writeUInt16LE(20, 4); // versão de quem escreveu
    entrada.writeUInt16LE(20, 6); // versão mínima para extrair
    entrada.writeUInt16LE(0x800, 8);
    entrada.writeUInt16LE(usaDeflate ? 8 : 0, 10);
    entrada.writeUInt16LE(hora, 12);
    entrada.writeUInt16LE(dia, 14);
    entrada.writeUInt32LE(soma, 16);
    entrada.writeUInt32LE(corpo.length, 20);
    entrada.writeUInt32LE(cru.length, 24);
    entrada.writeUInt16LE(nome.length, 28);
    entrada.writeUInt16LE(0, 30); // extra
    entrada.writeUInt16LE(0, 32); // comentário
    entrada.writeUInt16LE(0, 34); // disco
    entrada.writeUInt16LE(0, 36); // atributos internos
    entrada.writeUInt32LE(0o644 << 16, 38); // atributos externos: arquivo comum
    entrada.writeUInt32LE(offset, 42);

    central.push(entrada, nome);
    offset += local.length + nome.length + corpo.length;
  }

  const dir = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(0, 4); // disco
  fim.writeUInt16LE(0, 6); // disco do diretório
  fim.writeUInt16LE(files.length, 8);
  fim.writeUInt16LE(files.length, 10);
  fim.writeUInt32LE(dir.length, 12);
  fim.writeUInt32LE(offset, 16);
  fim.writeUInt16LE(0, 20); // sem comentário

  return Buffer.concat([...locais, dir, fim]);
}

module.exports = { zip };
