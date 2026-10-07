import { apiBase } from './session';
import { plugin } from './shell';

type Pacote = { version?: string; url?: string; checksum?: string; message?: string };

const updater = () => plugin('CapacitorUpdater');

export async function versaoAqui(): Promise<string | null> {
  const p = updater();
  if (!p?.current) return null;
  const atual = (await p.current()) as { bundle?: { version?: string }; native?: string };
  const v = atual?.bundle?.version;
  return !v || v === 'builtin' ? (atual?.native ?? null) : v;
}

async function oQueHaLa(daqui: string | null): Promise<Pacote> {
  const resposta = await fetch(`${apiBase}/api/app/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version_name: daqui ?? '', platform: 'android' }),
  });
  if (!resposta.ok) throw new Error('sem resposta do servidor');
  return (await resposta.json()) as Pacote;
}

export type Resultado = { trocou: boolean; texto: string };

export async function atualizarAgora(): Promise<Resultado> {
  const p = updater();
  if (!p) return { trocou: false, texto: 'Isto só existe no aplicativo.' };

  const daqui = await versaoAqui();
  const la = await oQueHaLa(daqui);

  if (!la.url || !la.version) {
    return { trocou: false, texto: la.message || 'Você já está na última versão.' };
  }

  const baixado = (await p.download({
    url: la.url,
    version: la.version,
    checksum: la.checksum,
  })) as { id?: string };

  if (!baixado?.id) throw new Error('o pacote não chegou inteiro');

  await p.set({ id: baixado.id });
  return { trocou: true, texto: 'Trocando…' };
}
