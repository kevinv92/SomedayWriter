import type { Diagnostic } from '../editor/types'

/**
 * A lightweight, dictionary-free spell/typo check: a curated map of common
 * misspellings plus repeated-word detection. Chosen so false positives are
 * near-zero without bundling a megabyte dictionary — and because Phase 4 is
 * about proving the pluggable path, not shipping Hunspell. A full dictionary
 * provider (e.g. `nspell` in the main process) can register alongside this one
 * later without any facade change. Pure so it's testable without a DOM.
 */

const CORRECTIONS: Record<string, string> = {
  teh: 'the',
  adn: 'and',
  thier: 'their',
  recieve: 'receive',
  recieved: 'received',
  seperate: 'separate',
  definately: 'definitely',
  occured: 'occurred',
  occurance: 'occurrence',
  untill: 'until',
  wich: 'which',
  becuase: 'because',
  beleive: 'believe',
  belive: 'believe',
  freind: 'friend',
  wierd: 'weird',
  acheive: 'achieve',
  accross: 'across',
  agressive: 'aggressive',
  apparant: 'apparent',
  arguement: 'argument',
  begining: 'beginning',
  calender: 'calendar',
  cemetary: 'cemetery',
  changable: 'changeable',
  collegue: 'colleague',
  comming: 'coming',
  commited: 'committed',
  concious: 'conscious',
  embarass: 'embarrass',
  enviroment: 'environment',
  existance: 'existence',
  familiar: 'familiar',
  finaly: 'finally',
  foriegn: 'foreign',
  goverment: 'government',
  grammer: 'grammar',
  gaurd: 'guard',
  harrass: 'harass',
  independant: 'independent',
  liason: 'liaison',
  maintainance: 'maintenance',
  neccessary: 'necessary',
  noticable: 'noticeable',
  occassion: 'occasion',
  persistant: 'persistent',
  possesion: 'possession',
  prefered: 'preferred',
  privelege: 'privilege',
  publically: 'publicly',
  reccomend: 'recommend',
  refered: 'referred',
  relevent: 'relevant',
  religous: 'religious',
  rythm: 'rhythm',
  succesful: 'successful',
  supercede: 'supersede',
  suprise: 'surprise',
  tommorow: 'tomorrow',
  truely: 'truly',
  unfortunatly: 'unfortunately',
  wether: 'whether',
  whcih: 'which',
  yeild: 'yield',
  alot: 'a lot',
  aswell: 'as well'
}

const WORD_RE = /[A-Za-z][A-Za-z']*/g

export function spellDiagnostics(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  let prev: { lower: string; to: number } | null = null
  let match: RegExpExecArray | null
  WORD_RE.lastIndex = 0
  while ((match = WORD_RE.exec(text)) !== null) {
    const word = match[0]
    const lower = word.toLowerCase()
    const from = match.index
    const to = from + word.length

    const fix = CORRECTIONS[lower]
    if (fix) {
      diagnostics.push({
        from,
        to,
        severity: 'warning',
        message: `Possible misspelling — did you mean “${fix}”?`,
        source: 'spell'
      })
    }

    // Repeated word ("the the"), but only when separated by pure whitespace.
    if (prev && prev.lower === lower && /^\s+$/.test(text.slice(prev.to, from))) {
      diagnostics.push({
        from,
        to,
        severity: 'warning',
        message: `Repeated word “${word}”.`,
        source: 'spell'
      })
    }
    prev = { lower, to }
  }
  return diagnostics
}
