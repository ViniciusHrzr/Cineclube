const { deflateRawSync, crc32 } = require('node:zlib');

function dosTime(at) {
  const d = new Date(at);
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { hora, dia };
}

function zip(files, at = Date.now()) {
  const { hora, dia } = dosTime(at);
  const locais = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nome = Buffer.from(file.name, 'utf8');
    const cru = file.data;
    const comprimido = deflateRawSync(cru, { level: 9 });
    const usaDeflate = comprimido.length < cru.length;
    const corpo = usaDeflate ? comprimido : cru;
    const soma = crc32(cru);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(usaDeflate ? 8 : 0, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(soma, 14);
    local.writeUInt32LE(corpo.length, 18);
    local.writeUInt32LE(cru.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);

    locais.push(local, nome, corpo);

    const entrada = Buffer.alloc(46);
    entrada.writeUInt32LE(0x02014b50, 0);
    entrada.writeUInt16LE(20, 4);
    entrada.writeUInt16LE(20, 6);
    entrada.writeUInt16LE(0x800, 8);
    entrada.writeUInt16LE(usaDeflate ? 8 : 0, 10);
    entrada.writeUInt16LE(hora, 12);
    entrada.writeUInt16LE(dia, 14);
    entrada.writeUInt32LE(soma, 16);
    entrada.writeUInt32LE(corpo.length, 20);
    entrada.writeUInt32LE(cru.length, 24);
    entrada.writeUInt16LE(nome.length, 28);
    entrada.writeUInt16LE(0, 30);
    entrada.writeUInt16LE(0, 32);
    entrada.writeUInt16LE(0, 34);
    entrada.writeUInt16LE(0, 36);
    entrada.writeUInt32LE(0o644 << 16, 38);
    entrada.writeUInt32LE(offset, 42);

    central.push(entrada, nome);
    offset += local.length + nome.length + corpo.length;
  }

  const dir = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(0, 4);
  fim.writeUInt16LE(0, 6);
  fim.writeUInt16LE(files.length, 8);
  fim.writeUInt16LE(files.length, 10);
  fim.writeUInt32LE(dir.length, 12);
  fim.writeUInt32LE(offset, 16);
  fim.writeUInt16LE(0, 20);

  return Buffer.concat([...locais, dir, fim]);
}

module.exports = { zip };
