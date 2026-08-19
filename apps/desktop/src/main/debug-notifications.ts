import type { PetNotification } from '../shared/ipc.js'

/**
 * Notificacoes de mentira, para exercitar o balao e a maquina de prioridade sem
 * depender de nenhuma fonte de eventos real.
 *
 * O pet nao decide **quando** falar — quem integra o app a alguma fonte de
 * eventos e que decide. Estas existem so para que o balao, as animacoes de
 * reacao e a arbitragem de prioridade possam ser conferidos isoladamente.
 */
export const DEBUG_NOTIFICATIONS: readonly (PetNotification & { readonly menuLabel: string })[] = [
  {
    menuLabel: 'Aviso',
    id: 'debug-aviso',
    icon: '🔔',
    title: 'Chegou algo novo',
    body: 'Uma notificacao comum, com duas acoes.',
    states: ['alert', 'waiting', 'review'],
    holdMs: 12_000,
    actions: [
      { id: 'ver', label: 'Ver' },
      { id: 'adiar', label: 'Depois' },
    ],
  },
  {
    menuLabel: 'Urgente',
    id: 'debug-urgente',
    icon: '🔥',
    title: 'Isto e urgente',
    body: 'Prioridade alta: segura o controle por mais tempo.',
    states: ['alert', 'waiting'],
    holdMs: 15_000,
    actions: [{ id: 'ver', label: 'Ver agora' }],
  },
  {
    menuLabel: 'Lembrete',
    id: 'debug-lembrete',
    icon: '⏱️',
    title: 'Faz duas horas nisso',
    body: 'Um empurraozinho, sem acao nenhuma.',
    states: ['point', 'jumping', 'waiting'],
    holdMs: 12_000,
  },
  {
    menuLabel: 'Comemoracao',
    id: 'debug-feito',
    icon: '✅',
    title: 'Terminou',
    body: 'Bom trabalho.',
    states: ['celebrate', 'review', 'jumping'],
    holdMs: 8_000,
  },
]
