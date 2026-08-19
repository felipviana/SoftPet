/**
 * O repertorio de estados do pet.
 *
 * O Orca so dispara 7 estados fixos; este projeto existe justamente para ir
 * alem disso, entao a lista abaixo e a fonte da verdade tanto para o motor de
 * animacao quanto para o gerador (que precisa saber quantas poses pedir a IA).
 */

/** Estados de vida propria: o que o pet faz quando ninguem mandou nada. */
export const AMBIENT_STATES = [
  'idle',
  'blink',
  'look-around',
  'sit',
  'sleep',
  'stretch',
  'yawn',
] as const

/** Deslocamento pela tela e manipulacao direta pelo usuario. */
export const LOCOMOTION_STATES = ['walk-left', 'walk-right', 'drag', 'fall'] as const

/** Respostas a eventos externos e a interacao. */
export const REACTION_STATES = [
  'wave',
  'alert',
  'point',
  'celebrate',
  'sad',
  'coffee',
] as const

export const PET_STATES = [
  ...AMBIENT_STATES,
  ...LOCOMOTION_STATES,
  ...REACTION_STATES,
] as const

export type PetState = (typeof PET_STATES)[number]

const PET_STATE_SET: ReadonlySet<string> = new Set(PET_STATES)

export function isPetState(value: string): value is PetState {
  return PET_STATE_SET.has(value)
}

/**
 * Os unicos nomes que o overlay do Orca chega a selecionar. Guardado aqui para
 * o dia em que exportarmos um `.codex-pet` a partir de um pet nosso: qualquer
 * outro nome vira peso morto no bundle.
 */
export const ORCA_STATES = [
  'idle',
  'running',
  'waiting',
  'review',
  'jumping',
  'running-right',
  'running-left',
] as const

export type OrcaState = (typeof ORCA_STATES)[number]
