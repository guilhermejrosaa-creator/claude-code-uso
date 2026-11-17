import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'uso',
  component: 'Pane',
  requestId: 'uso',
  props: { title: 'Uso', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('painel vazio abre em todas as superfícies', async ($, on) => {
  on('command.register', () => ({ value: { command: 'uso' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 120000, window: 1000000, percent: 12 }, rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: '2026-11-17T02:00:00Z' }, { kind: 'seven_day', percentUsed: 18 }] } }))
  on('store.get', () => ({ value: [{ tipo: 'Navegador (Chrome)', tokens: 400000, quando: 1 }] }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Esta sessão/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /0 tokens gastos/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /400 mil/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Limite de 5 h/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /120 mil de 1,0 mi/ })).toBeDefined()
    await ui.unmount()
  }
})
