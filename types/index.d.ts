export type Conta = { entrada: number; saida: number; cacheLido: number; cacheGravado: number }
export type Pedido = {
  id: string
  texto: string
  inicio: number
  conta: Conta
  passos: number
  porFerramenta: Record<string, number>
}
export type Resumo = {
  total: Conta
  porFerramenta: Record<string, { tokens: number; vezes: number }>
  pedidos: Pedido[]
}
export type Extra = {
  limites: { kind: string; percent: number; resetsAt?: string }[]
  contexto: { tokens?: number; janela: number; percent?: number } | null
  custoUsd?: number
  ramLivre?: number
  atualizadoEm: number
}
export type Historico = { tipo: string; tokens: number; quando: number }

declare module 'claude-code' {
  interface PluginState {
    uso: { resumo: Shaped<Resumo>; extra: Shaped<Extra> }
  }
}
