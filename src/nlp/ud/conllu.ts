// import { StringDict } from '../../types'
// import { parseIntStrict, buildObject } from '../../lang'
import { mu, Mu } from '../../mu'
import { UdPos } from './tagset'
import { makeObject } from '../../lang'
import { Dict } from '../../types'
// import { UdMiRelation } from './syntagset'


////////////////////////////////////////////////////////////////////////////////
export interface ConlluToken {
  index: number
  form: string
  lemma: string
  upos: UdPos
  xpos: string
  feats: Dict<string>
  head: string
  rel: string
  deps: [number, string][]
  misc: Dict<string>
}

////////////////////////////////////////////////////////////////////////////////
export const enum Structure { document, paragraph, sentence }

////////////////////////////////////////////////////////////////////////////////
export interface StructureToken {
  type: Structure
  opening: boolean
}

////////////////////////////////////////////////////////////////////////////////
export function parseConllu(lines: Iterable<string>) {
  return mu(streamparseConllu(lines))
    .filter(x => !x.structure || x.structure.type === Structure.sentence && !x.structure.opening)
    .map(x => x.structure ? undefined : x.token)
    .split(x => !x)
    .filter(x => x.length)
}

////////////////////////////////////////////////////////////////////////////////
export function* streamparseConllu(lines: Iterable<string>) {
  let insideDoc = false
  let insidePar = false
  let insideSent = false

  for (let line of lines) {
    line = line.trim()
    if (line.startsWith('# newdoc')) {
      if (insideDoc) {
        yield makeStructure(Structure.document, false)
      }
      yield makeStructure(Structure.document, true)
      insideDoc = true
    } else if (line.startsWith('# newpar')) {
      if (insidePar) {
        yield makeStructure(Structure.paragraph, false)
      }
      yield makeStructure(Structure.paragraph, true)
      insidePar = true
    } else if (!line && insideSent) {
      yield makeStructure(Structure.sentence, false)
      insideSent = false
    } else if (line && !line.startsWith('#')) {
      if (!insideSent) {
        yield makeStructure(Structure.sentence, true)
        insideSent = true
      }
      yield makeToken(parseConlluTokenLine(line))
    }
  }
  if (insidePar) {
    yield makeStructure(Structure.paragraph, false)
  }
  if (insideDoc) {
    yield makeStructure(Structure.document, false)
  }
}

////////////////////////////////////////////////////////////////////////////////
export function parseConlluTokenLine(value: string) {
  let [indexStr, form, lemma, upos, xpos, featsStr, head, rel, , miscStr] =
    value.split('\t').map(x => x === '_' ? '' : x)

  let index = Number.parseInt(indexStr)
  let feats = parseUdKeyvalues(featsStr)
  let misc = parseUdKeyvalues(miscStr)

  return { index, form, lemma, upos, xpos, feats, head, rel, misc } as ConlluToken
}

//------------------------------------------------------------------------------
function parseUdKeyvalues(keyvals: string) {
  if (!keyvals) {
    return makeObject<string>([])
  }
  return makeObject(keyvals.split('|').map(x => x.split('=')) as [string, string][])
}

//------------------------------------------------------------------------------
function makeStructure(type: Structure, opening: boolean) {
  return {
    structure: { type, opening } as StructureToken,
    token: undefined as ConlluToken
  }
}

//------------------------------------------------------------------------------
function makeToken(token: ConlluToken) {
  return {
    structure: undefined as StructureToken,
    token
  }
}
