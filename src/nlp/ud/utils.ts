import { Token } from '../token'
import { toUd, udFeatures2conlluString } from './tagset'



////////////////////////////////////////////////////////////////////////////////
export function* tokenStream2conllu(stream: Iterable<[Token, Token]>) {
  let tokenIndex = 1
  let sentenceId = 1
  for (let [token, nextToken] of stream) {
    if (tokenIndex === 1) {
      yield sentenceIdLine(sentenceId++)
    }
    if (token.isGlue()) {
      continue
    }
    if (token.isSentenceEnd()) {
      tokenIndex = 1
      yield ''
    } else if (token.isWord()) {
      let interp = token.firstInterp()
      let { pos, features } = toUd(interp)
      let misc = `miVesum=${interp.toVesumStr()}`
      if (nextToken && nextToken.isGlue()) {
        misc += '|SpaceAfter=No'
      }
      yield [
        tokenIndex++,
        token.form,
        interp.lemma,
        pos,
        '_',
        udFeatures2conlluString(features),
        '_',
        '_',
        '_',
        misc,
      ].join('\t')
    }
  }
}

//------------------------------------------------------------------------------
function sentenceIdLine(id: number) {
  return `# sent_id ${id}`
}
