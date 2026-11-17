# Uso — painel de tokens e limites para o Claude Code

Painel lateral para o Claude Code que mostra, enquanto você trabalha:

- **Limite de 5 h** e **limite semanal** do plano, com % e quando renova
- **Memória da conversa** (quanto do contexto já foi usado)
- **RAM do Mac** (macOS)
- **Tokens gastos na sessão**, por ferramenta e por pedido
- **Média por tipo de pedido**, guardada entre sessões, e uma estimativa em 1 linha antes de tarefas grandes
- Uma linha de status sempre visível: `Uso · 5h 60% · semana 91% · memória 12% · RAM 54% · sessão 39 mil tokens`

Comando: `/uso` abre o painel. Ele fica ao lado da conversa no modo tela cheia do Claude Code (`CLAUDE_CODE_NO_FLICKER=1 claude`, terminal com 110+ colunas); no modo normal aparece acima da caixa de texto.

## Instalar

No prompt do Claude Code (terminal):

```
/plugin install uso --marketplace guilhermejrosaa-creator/claude-code-uso
```

Responda `y` para adicionar o marketplace e escolha o escopo.

Pelo terminal:

```
claude plugin install uso --marketplace guilhermejrosaa-creator/claude-code-uso
```

No app desktop: clique em **+** ao lado da caixa de texto → **Plugins** → **Add marketplace** com `guilhermejrosaa-creator/claude-code-uso` → **Add plugin**.

Seus números ficam só no seu computador.

Feito por Guilherme Rosa.
