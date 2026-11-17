import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Conta, Extra, Historico, Pedido, Resumo } from '../types'

// Painel "Uso": quantos tokens cada pedido e cada ferramenta gastam nesta sessão,
// com um histórico entre sessões ($.store) pra estimar o próximo pedido.
const PANE = 'uso'
const VAZIA: Conta = { entrada: 0, saida: 0, cacheLido: 0, cacheGravado: 0 }
const RESUMO_VAZIO: Resumo = { total: VAZIA, porFerramenta: {}, pedidos: [] }
const resumo = atom({ plugin: 'uso', key: 'resumo' } as const, RESUMO_VAZIO, { shape: 'resumo-1' })

const extra = atom({ plugin: 'uso', key: 'extra' } as const, { limites: [], contexto: null, atualizadoEm: 0 } as Extra, { shape: 'extra-1' })

// Limites do plano (5 h e semanal), memória da conversa (contexto) e RAM livre do Mac
async function atualizarExtra($: EngineInterface) {
  const u = await $.session.usage()
  let ramLivre: number | undefined
  try {
    let out = ''
    const st = $.process.spawn({ argv: ['/usr/bin/memory_pressure', '-Q'] })
    for await (const c of st) out += c.text
    const m = out.match(/free percentage:\s*(\d+)%/)
    if (m && m[1]) ramLivre = Number(m[1])
  } catch {
    ramLivre = undefined
  }
  await update($, extra, () => ({
    limites: u.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: r.resetsAt })),
    contexto: u.context ? { tokens: u.context.tokens, janela: u.context.window, percent: u.context.percent } : null,
    custoUsd: u.cost?.usd,
    ramLivre,
    atualizadoEm: Date.now(),
  }))
  await linhaDeStatus($)
}

// Linha de status sempre visível embaixo: limites, memória da conversa, RAM e gasto da sessão
async function linhaDeStatus($: EngineInterface) {
  const x = await read($, extra)
  const r = await read($, resumo)
  const partes = [
    ...x.limites.map(l => `${l.kind === 'five_hour' ? '5h' : l.kind === 'seven_day' ? 'semana' : l.kind} ${Math.round(l.percent)}%`),
    x.contexto ? `memória ${Math.round(x.contexto.percent ?? 0)}%` : '',
    x.ramLivre !== undefined ? `RAM ${100 - x.ramLivre}%` : '',
    `sessão ${fmt(gasto(r.total))} tokens`,
  ].filter(Boolean)
  $.ui.status(`Uso · ${partes.join(' · ')}`)
}

const nomeLimite = (k: string) => (k === 'five_hour' ? 'Limite de 5 h' : k === 'seven_day' ? 'Limite semanal' : k)
const quando = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit' }) : ''
const barra = (p: number, n = 14) => {
  const cheio = Math.max(0, Math.min(n, Math.round((p / 100) * n)))
  return '█'.repeat(cheio) + '░'.repeat(n - cheio)
}

const somaConta = (a: Conta, b: Conta): Conta => ({
  entrada: a.entrada + b.entrada,
  saida: a.saida + b.saida,
  cacheLido: a.cacheLido + b.cacheLido,
  cacheGravado: a.cacheGravado + b.cacheGravado,
})
// "Gasto" = o que pesa: entrada nova + gravação de cache + saída. Cache lido sai bem mais barato e fica à parte.
const gasto = (c: Conta) => c.entrada + c.cacheGravado + c.saida
const tudo = (c: Conta) => gasto(c) + c.cacheLido

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace('.', ',')} mi` : n >= 1000 ? `${Math.round(n / 1000)} mil` : `${n}`

// Nome curto e em português pra cada ferramenta
function nomeFerramenta(t: string) {
  const m = t.match(/^mcp__(.+?)__(.+)$/)
  if (m && m[1] && m[2]) {
    const srv = m[1].replace(/^claude-in-chrome$/, 'Chrome').replace(/^claude_ai_/, '').replace(/_/g, ' ')
    return `${srv}: ${m[2].replace(/_/g, ' ')}`
  }
  const pt: Record<string, string> = {
    Bash: 'Comandos (Bash)',
    Read: 'Ler arquivo',
    Edit: 'Editar arquivo',
    Write: 'Escrever arquivo',
    Agent: 'Subagente',
    Skill: 'Skill',
    ToolSearch: 'Buscar ferramenta',
    WebSearch: 'Pesquisa web',
    WebFetch: 'Abrir página',
    Artifact: 'Artifact',
  }
  return pt[t] ?? t
}

// Tipo do pedido pelo que mais gastou: é com ele que a média é feita
function tipoDoPedido(p: Pedido) {
  const top = Object.entries(p.porFerramenta).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Só conversa'
  if (top.startsWith('Chrome')) return 'Navegador (Chrome)'
  if (top === 'Comandos (Bash)') return 'Comandos e scripts'
  if (/arquivo/.test(top)) return 'Arquivos (ler/editar)'
  if (top === 'Subagente') return 'Subagente'
  if (top === 'Resposta (texto)' || top === 'Só conversa') return 'Só conversa'
  return 'Outras ferramentas'
}

function medias(h: Historico[]) {
  const por: Record<string, number[]> = {}
  for (const x of h) (por[x.tipo] ??= []).push(x.tokens)
  return Object.entries(por)
    .map(([tipo, v]) => ({ tipo, media: Math.round(v.reduce((a, b) => a + b, 0) / v.length), n: v.length }))
    .sort((a, b) => b.media - a.media)
}

const lerHistorico = async ($: EngineInterface): Promise<Historico[]> => {
  const v = await $.store.get('historico')
  return Array.isArray(v) ? (v as Historico[]) : []
}

export const register: Register = on => {
  let estimativas = ''

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'uso', description: 'Abre o painel Uso: tokens por pedido e por ferramenta' })
    const ms = medias(await lerHistorico($))
    // Fixo durante a sessão: o texto do prompt não muda a cada turno (não quebra o cache)
    estimativas = ms.length
      ? `Médias de tokens por pedido neste Mac (painel Uso): ${ms
          .map(m => `${m.tipo} ~${fmt(m.media)} (${m.n} pedidos)`)
          .join('; ')}.`
      : 'Ainda não há histórico de tokens; estime pelo tamanho da tarefa (conversa curta ~20 mil, navegador ou vídeo ~300 mil a 2 mi).'
    void $.ui.open({ id: PANE, title: 'Uso', rows: 40, columns: 24, backgroundColor: 'transparent' })
    await atualizarExtra($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'uso' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Uso', rows: 40, columns: 24, backgroundColor: 'transparent' })
    const r = await read($, resumo)
    const top = Object.entries(r.porFerramenta)
      .sort((a, b) => b[1].tokens - a[1].tokens)
      .slice(0, 5)
      .map(([n, v]) => `${n}: ${fmt(v.tokens)}`)
      .join(' · ')
    return { text: `Sessão: ${fmt(gasto(r.total))} tokens gastos (+${fmt(r.total.cacheLido)} de cache lido). ${top}` }
  })

  // Pede pra eu sempre dar a estimativa antes de tarefa grande
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return {
      ...r,
      sections: [
        ...r.sections,
        {
          id: 'uso:estimativa',
          scope: 'session' as const,
          text: `Antes de começar uma tarefa que vai usar várias ferramentas (navegador, renderizar vídeo, várias edições, subagente), diga em 1 linha a estimativa no formato "Estimativa: ~X mil tokens" e siga sem esperar resposta. ${estimativas}`,
        },
      ],
    }
  })

  // Novo pedido: o anterior vai pro histórico
  on('prompt.submit', async ($, e, next) => {
    const antes = await read($, resumo)
    const ultimo = antes.pedidos[antes.pedidos.length - 1]
    if (ultimo && gasto(ultimo.conta) > 0) {
      const h = await lerHistorico($)
      await $.store.set('historico', [...h, { tipo: tipoDoPedido(ultimo), tokens: gasto(ultimo.conta), quando: ultimo.inicio }].slice(-200))
    }
    const texto = (e.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 70) || '(sem texto)'
    const novo: Pedido = { id: `${Date.now()}`, texto, inicio: Date.now(), conta: VAZIA, passos: 0, porFerramenta: {} }
    await update($, resumo, r => ({ ...r, pedidos: [...r.pedidos, novo].slice(-30) }))
    return next(e)
  })

  // Cada resposta do modelo: soma o que a API informou e divide entre as ferramentas que ela chamou
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const u = r?.usage
    if (u) {
      const c: Conta = {
        entrada: u.input_tokens,
        saida: u.output_tokens,
        cacheLido: u.cache_read_input_tokens,
        cacheGravado: u.cache_creation_input_tokens,
      }
      const g = gasto(c)
      const nomes = e.agentId
        ? ['Subagente']
        : r.toolUses.length
          ? r.toolUses.map(t => nomeFerramenta(t.name))
          : ['Resposta (texto)']
      const parte = Math.round(g / nomes.length)
      await update($, resumo, s => {
        const porF = { ...s.porFerramenta }
        for (const n of nomes) porF[n] = { tokens: (porF[n]?.tokens ?? 0) + parte, vezes: (porF[n]?.vezes ?? 0) + 1 }
        const pedidos = s.pedidos.length
          ? s.pedidos.map((p, i) => {
              if (i !== s.pedidos.length - 1) return p
              const pf = { ...p.porFerramenta }
              for (const n of nomes) pf[n] = (pf[n] ?? 0) + parte
              return { ...p, conta: somaConta(p.conta, c), passos: p.passos + 1, porFerramenta: pf }
            })
          : s.pedidos
        return { total: somaConta(s.total, c), porFerramenta: porF, pedidos }
      })
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    void atualizarExtra($)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const r = await read($, resumo)
    const x = await read($, extra)
    const ms = medias(await lerHistorico($))
    const ferramentas = Object.entries(r.porFerramenta).sort((a, b) => b[1].tokens - a[1].tokens)
    const linhas = Math.max(6, (e.viewport?.rows ?? 30) - 18)
    const pedidos = [...r.pedidos].reverse().filter(p => p.passos > 0)
    const larg = Math.max(10, (e.props?.bodyColumns ?? 30) - 6)
    // Cada medidor em pé: nome e % em cima, barra cheia embaixo, detalhe apagado (estilo monitor de CPU/memória)
    const Medidor = ({ nome, pct, info }: { nome: string; pct: number; info: string }) => (
      <Box flexDirection="column" marginBottom={1}>
        <Box justifyContent="space-between">
          <Text>{nome}</Text>
          <Text bold color={pct >= 80 ? 'red' : pct >= 50 ? 'yellow' : 'green'}>{Math.round(pct)}%</Text>
        </Box>
        <Text color={pct >= 80 ? 'red' : pct >= 50 ? 'yellow' : 'green'}>{barra(pct, larg + 4)}</Text>
        {info ? <Text color="gray">{info}</Text> : null}
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Text bold color="blue">Plano</Text>
        {x.limites.length === 0 && <Text color="gray">Limites aparecem depois da 1ª resposta.</Text>}
        {x.limites.map(l =>
          Medidor({ nome: nomeLimite(l.kind), pct: l.percent, info: l.resetsAt ? `renova ${quando(l.resetsAt)}` : '' }),
        )}
        {x.contexto &&
          Medidor({ nome: 'Memória', pct: x.contexto.percent ?? 0, info: `${fmt(x.contexto.tokens ?? 0)} de ${fmt(x.contexto.janela)}` })}
        {x.ramLivre !== undefined && Medidor({ nome: 'RAM do Mac', pct: 100 - x.ramLivre, info: `${x.ramLivre}% livre` })}
        {x.custoUsd !== undefined && <Text color="gray">Custo na API: US$ {x.custoUsd.toFixed(2)}</Text>}

        <Text> </Text>
        <Text bold color="blue">Esta sessão</Text>
        <Text>
          {fmt(gasto(r.total))} tokens gastos
          <Text color="gray"> (+{fmt(r.total.cacheLido)} cache lido)</Text>
        </Text>
        <Text color="gray">
          entrada {fmt(r.total.entrada + r.total.cacheGravado)} · saída {fmt(r.total.saida)}
        </Text>

        <Text> </Text>
        <Text bold color="blue">Por ferramenta</Text>
        {ferramentas.length === 0 && <Text color="gray">Ainda nada.</Text>}
        {ferramentas.slice(0, Math.ceil(linhas / 2)).map(([n, v]) => (
          <Text wrap="truncate-end">
            {fmt(v.tokens).padStart(7)} <Text color="gray">{`${v.vezes}×`.padStart(4)}</Text> {n}
          </Text>
        ))}

        <Text> </Text>
        <Text bold color="blue">Por pedido</Text>
        {pedidos.length === 0 && <Text color="gray">Ainda nada.</Text>}
        {pedidos.slice(0, Math.floor(linhas / 2)).map(p => (
          <Text wrap="truncate-end">
            {fmt(gasto(p.conta)).padStart(7)} <Text color="gray">{p.texto}</Text>
          </Text>
        ))}

        {ms.length > 0 && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold color="blue">Média por tipo (estimativa)</Text>
            {ms.slice(0, 6).map(m => (
              <Text>
                {`~${fmt(m.media)}`.padStart(8)} <Text color="gray">{m.tipo} ({m.n})</Text>
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
