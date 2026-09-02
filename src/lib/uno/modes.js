import * as classic from './engine.js'
import * as noMercy from '../no-mercy/engine.js'

export const MODES = {
  classic: { id: 'classic', label: 'Classic', engine: classic },
  'no-mercy': { id: 'no-mercy', label: 'UNO No Mercy', engine: noMercy },
}

export function getEngine(mode) {
  return (MODES[mode] || MODES.classic).engine
}
