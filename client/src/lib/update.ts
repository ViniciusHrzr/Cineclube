import { apiBase } from './session';
import { plugin } from './shell';

/* ══════════════════════════════════════════════════════════════════════════
   ATUALIZAR O APLICATIVO NA MÃO.

   O ciclo normal é automático e não pede nada a ninguém: na abertura o app
   pergunta se há pacote novo, baixa, e troca na abertura seguinte. Ver ota.js.

   O problema desse ciclo não é ele falhar — é ele ser INVISÍVEL. Quem abre o
   app depois de um conserto e vê o defeito de novo não tem como saber se o
   conserto não chegou, se chegou e ainda não trocou, ou se o conserto não
   conserta. Os três se parecem, e os três levam a fechar o app mais uma vez.

   Então aqui existem duas coisas: dizer em que versão este aparelho está, e
   trocar agora sem esperar a próxima abertura.

   Nada disto existe no site: lá recarregar a página JÁ é isto.
   ══════════════════════════════════════════════════════════════════════════ */

type Pacote = { version?: string; url?: string; checksum?: string; message?: string };

const updater = () => plugin('CapacitorUpdater');

/** A versão que este aparelho está rodando, ou nulo fora do aplicativo. */
export async function versaoAqui(): Promise<string | null> {
  const p = updater();
  if (!p?.current) return null;
  const atual = (await p.current()) as { bundle?: { version?: string }; native?: string };
  const v = atual?.bundle?.version;
  /* `builtin` é o pacote que veio dentro do APK: nenhuma troca aconteceu ainda,
     e a versão que interessa dizer é a da loja. */
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

/**
 * Pergunta, baixa e troca — agora. Quando troca, a tela recarrega sozinha e
 * esta promessa nunca resolve; é o comportamento certo, e por isso quem chama
 * não deve desligar o "aguarde" no `finally`.
 */
export async function atualizarAgora(): Promise<Resultado> {
  const p = updater();
  if (!p) return { trocou: false, texto: 'Isto só existe no aplicativo.' };

  const daqui = await versaoAqui();
  const la = await oQueHaLa(daqui);

  /* Sem `url` o servidor está dizendo que não há o que baixar — ou porque esta
     já é a última, ou porque ele não tem pacote para servir. A frase dele é
     melhor que qualquer uma inventada aqui. */
  if (!la.url || !la.version) {
    return { trocou: false, texto: la.message || 'Você já está na última versão.' };
  }

  const baixado = (await p.download({
    url: la.url,
    version: la.version,
    checksum: la.checksum,
  })) as { id?: string };

  if (!baixado?.id) throw new Error('o pacote não chegou inteiro');

  /* Daqui para a frente a tela é outra: `set` troca o pacote e recarrega. O
     cliente novo avisa que subiu — ver appIsReady —, e se não avisar em dez
     segundos o plugin devolve o anterior sozinho. */
  await p.set({ id: baixado.id });
  return { trocou: true, texto: 'Trocando…' };
}
