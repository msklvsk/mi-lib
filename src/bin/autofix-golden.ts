#!/usr/bin/env node

import * as fs from 'fs'
import { basename } from 'path'
import * as glob from 'glob'
import * as minimist from 'minimist'
import * as _ from 'lodash'
import { parseXmlFileSync } from '../xml/utils.node'
import { AbstractElement } from 'xmlapi'
import { MorphInterp } from '../nlp/morph_interp'
import { fetchText } from '../request_utils'
import * as f from '../nlp/morph_features'
import { Token } from '../nlp/token'
import { serializeMiDocument, tokenStream2sentences, mixml2tokenStream } from '../nlp/utils'
// import { $t } from '../nlp/text_token'
import { removeNamespacing, autofixSomeEntitites } from '../xml/utils'
import { toSortableDatetime, fromUnixStr } from '../date'
import { mu } from '../mu'
import * as strUtils from '../string_utils'
import { createDictionarySync } from '../nlp/dictionary/factories.node'
import { MorphAnalyzer } from '../nlp/morph_analyzer/morph_analyzer'
import { GraphNode } from '../lib/graph'
import { uEq, uEqSome } from '../nlp/ud/utils'
import { toUd } from '../nlp/ud/tagset'
import { PREDICATES } from '../nlp/ud/uk_grammar'
import * as g2 from '../nlp/uk_grammar'
import * as g from '../nlp/ud/uk_grammar'
import * as tereveni from '../corpus-workflow/extractors/tereveni'



const REPLACE_RE = /#>([^\s@]+)(?:@(\S+))?/


// temp
const KNOWN_NONDIC_LEMMAS = new Set([
  'п.',
  'неповчальний',
  'і.',
  'телеведучий',
])

//------------------------------------------------------------------------------
function prepareIds(path: string) {
  return new Set(fs.readFileSync(path, 'utf8')
    .trim()
    .split(/\n+/g)
    .map(x => x.trim())
    .filter(x => !x.startsWith('#'))
    .join(' ')
    .split(/\s+/g))
}

//------------------------------------------------------------------------------
async function main() {
  let args = minimist(process.argv.slice(2), {
    boolean: [
      'tranformIds',
      'afterAnnotator',
    ]
  })
  let [globStr, sequencePath] = args._
  let files = glob.sync(globStr)
  let tokenCount = 0

  if (args.tranformIds) {
    var ids = prepareIds(path)
  }

  if (args.tranformIdsInline) {
    ids = new Set(args.tranformIdsInline.trim().split(/\s+/g))
  }

  let idSequence: number
  if (fs.existsSync(sequencePath)) {
    idSequence = Number.parseInt(fs.readFileSync(sequencePath, 'utf8').trim())
  }

  // prepare xml
  if (1) {
    console.log(`removing legacy namespaces & autofixing xml…`)
    autofixXml(files)
  }


  console.log(`applying autofixes…`)

  const dict = createDictionarySync()
  const analyzer = new MorphAnalyzer(dict).setExpandAdjectivesAsNouns(true)

  for (let file of files) {
    try {
      console.log(`autofixing ${basename(file)}`)

      let root = parseXmlFileSync(file)

      killEmptyElements(root)
      insertSb(root)
      swapSb(root)
      await addDocMeta(root)
      // renameStructures(root)

      {
        let tokenEls = [...root.evaluateElements('//w_')]
        // remove redundant attributes
        if (1) {
          for (let w of tokenEls) {
            // w.removeAttribute('n')
            w.removeAttribute('nn')
            w.removeAttribute('disamb')
            w.removeAttribute('author')
          }
        }
        if (0) {
          idSequence = splitFractions(tokenEls, idSequence)
        }

        for (let tokenEl of tokenEls) {
          // insertGlueIfNeeded(tokenEl)
        }
      }

      // do safe transforms
      let interpEls = root.evaluateElements('//w_/w')
      for (let interpEl of interpEls) {
        // continue
        let form = interpEl.text() as string  // todo: remove as
        let tag = interpEl.attribute('ana')
        let lemma = interpEl.attribute('lemma')
        if (!tag || !lemma) {
          throw new Error(`No tag/lemma for ${form}`)
        }
        let interp: MorphInterp
        try {
          interp = MorphInterp.fromVesumStr(
            interpEl.attribute('ana'), interpEl.attribute('lemma'), undefined, true)
        } catch (e) {
          console.error(e.message)
          continue
        }

        let interpsInDict = analyzer.tag(form)
        let presentInDict = interpsInDict.some(dictInterp => dictInterp.featurewiseEquals(interp))
        // console.log(presentInDict)
        if (!presentInDict) {
          // negativity
          let newInterp = interp.clone().setIsNegative()
          if (interpsInDict.some(x => x.featurewiseEquals(newInterp))) {
            interp = newInterp
          }
        }

        // advp lemmas
        if (interp.isConverb()) {
          let dictInterps = analyzer.tag(form).filter(x => x.isConverb)
          if (dictInterps.length) {
            interp.lemma = dictInterps[0].lemma
          }
        }

        // adj as noun lemmas
        let lemma2 = interpEl.attribute('lemma2')
        if (interp.isAdjectiveAsNoun() && !lemma2) {
          let adjLemma = lemma2 || interp.lemma
          interpEl.setAttribute('lemma2', adjLemma)
          let lexeme = dict.lookupLexemesByLemma(adjLemma)
            .find(([{ flags }]) => MorphInterp.fromVesumStr(flags).isAdjective())
          if (lexeme) {
            let nounLemma =
              lexeme.find(({ flags }) => {
                let cursor = MorphInterp.fromVesumStr(flags)
                let ret = !cursor.isUncontracted()
                  && ((cursor.isPlural() && cursor.features.number === interp.features.number)
                    || cursor.features.gender === interp.features.gender)
                return ret
              })
            if (nounLemma) {
              interp.lemma = nounLemma.form
            } else {
              console.log(`Nothingo ${interp.lemma}`)
              // console.log(`Nothingo ${interp.lemma}`)
            }
          } else if (!interp.isOrdinalNumeral() && !KNOWN_NONDIC_LEMMAS.has(interp.lemma)) {
            console.log(`CAUTION: no paradigm in dict: ${interp.lemma}`)
          }
        }

        if (lemma2 && !interp.isAdjectiveAsNoun()) {
          interp.lemma = lemma2
          interpEl.removeAttribute('lemma2')
        }

        if (interp.isVerb() && interp.lemma === 'бути') {
          let dep = interpEl.parent().attribute('dep')
          if (dep && /\-(aux|cop)$/.test(dep)) {
            interp.setIsAuxillary()
          }
        }

        // advps without tense
        g.setTenseIfConverb(interp, form)

        // if (isNoninfl(interp)) {
        //   let oldLemma = interp.lemma
        //   interp.lemma = interpEl.parent().attribute('corrected') || form.toLowerCase()
        //   if (oldLemma.endsWith('.')) {
        //     interp.lemma += '.'
        //   }
        // }

        saveInterp(interpEl, interp)
      }
      tokenCount += [...root.evaluateElements('//w_')].length

      // assign id's
      if (idSequence !== undefined) {
        const xpath = ['doc', 'p', 'sb', 's', 'w_', 'pc']
          .map(x => `//${x}[not(@id)]`)
          .join('|')
        let tokenEls = [...root.evaluateElements(xpath)]
        for (let token of tokenEls) {
          token.setAttribute('id', id2str(idSequence++))
        }
      }

      // check id uniqueness and build id-element map
      let id2el = new Map<string, AbstractElement>()
      let idedElements = root.evaluateElements('//*[@id]')
      for (let el of idedElements) {
        let id = el.attribute('id')
        if (id2el.has(id)) {
          throw new Error(`Duplicate id: ${id}`)
        }
        id2el.set(id, el)
      }

      let documentTokens = mu(mixml2tokenStream(root)).toArray()
      let sentenceStream = tokenStream2sentences(documentTokens)
      for (let { sentenceId, dataset, nodes } of sentenceStream) {
        let roots = nodes.filter(x => x.isRoot())
        let sentenceHasOneRoot = roots.length === 1

        // console.log(ids.size)
        if (ids && TRANSFORMS[args.transform]) {
          // console.log(id2el)
          nodes.forEach(t => {
            if (ids.has(t.node.id)) {
              // console.log(t.node.form)
              TRANSFORMS[args.transform](t)
            }
          })
        }

        for (let [index, [prevNode, node, nextNode]] of mu(nodes).window(2, 1).entries()) {
          let token = node.node
          let parent = node.parent && node.parent.node
          let interp = token.interp
          const udInterp = toUd(interp.clone())

          if (token.comment) {
            let match = token.comment.match(REPLACE_RE)
            if (match) {
              let [, tag, lemma] = match
              tag = tag.replace('&amp;', '&')  // sometimes it's copyped from xml
              lemma = lemma || interp.lemma
              if (tag.startsWith(':')) {
                interp.setFromVesumStr(tag.substr(1), lemma)
              } else {
                interp.resetFromVesumStr(tag, lemma)
              }
            }
            token.comment = token.comment.replace(REPLACE_RE, '').trim()
          }

          // remove duplicates
          if (token.deps.length > 1) {
            let n = token.deps.length
            token.deps = _.uniqWith(token.deps, (a, b) =>
              a.headId === b.headId && a.relation === b.relation)
          }

          if (token.getForm() !== token.form) {
            interp.setIsTypo(false)
          }

          if (token.rel && interp.isPunctuation()) {
            token.rel = 'punct'
          }

          if (interp.isX()) {
            interp.lemma = token.getForm()
          }

          if (!interp.lemma.includes('’')
            && (
              interp.isParticle()
              || interp.isConjunction()
              || interp.isPreposition()
              || interp.isAdverb()
              || interp.isInterjection()
              || interp.isUninflectable()
            )
            || interp.isPunctuation()
            || interp.isSymbol()
            || interp.isX()
            || interp.isError()
          ) {
            if (strUtils.isAllLower(interp.lemma)) {
              // interp.lemma = token.getForm().toLowerCase()
            } else {

            }
          }

          if (uEqSome(token.rel, ['cc']) && interp.lemma === 'бути') {
            token.rel = parent.interp.isVerbial() ? 'aux' : 'cop'
          }

          if (interp.isName()) {
            interp.setIsAnimate().setIsProper()
          }

          if (PREDICATES.isAuxWithNoCopAux(node)
            || sentenceHasOneRoot && node.isRoot() && node.node.interp.isAuxillary()) {
            node.node.interp.setIsAuxillary(false)
          }

          if (token.rel === 'mark' && token.interp.isAdverb() && token.interp.isRelative()) {
            token.rel = 'advmod'
          }

          if (token.rel
            && token.interp.isParticle()
            && token.interp.isNegative()
            && !token.isPromoted
            && !node.children.some(x => uEq(x.node.rel, 'fixed'))
            && !uEqSome(token.rel, ['fixed', 'parataxis', 'conj:parataxis', 'conj'])
          ) {
            token.rel = 'advmod'
          }

          if (token.form.toLowerCase() === 'то' && token.interp.isSubordinative()) {
            if (token.rel) {
              token.rel = 'discourse'
            }
            interp.resetFromVesumStr('part:conseq', token.interp.lemma)
            saveToken(token, id2el.get(token.id))
          }

          if (['це', 'то'].includes(token.form.toLowerCase())
            && token.interp.isParticle()
            && token.rel === 'expl') {
            interp.resetFromVesumStr('noun:inanim:n:v_naz:&pron:dem', token.interp.lemma)
          }

          if (token.rel === 'punct' && token.interp.isCoordinating()) {
            token.rel = 'cc'
          }

          if (token.interp.isInterjection()) {
            let newInterp = analyzer.tag(token.form).find(x => x.isInstant())
            if (newInterp) {
            }
          }

          if (!node.isRoot()
            && interp.isPreposition()
            && !uEqSome(token.rel, ['conj', 'flat:title', 'fixed'])
            && !g.hasChild(node, 'fixed')
          ) {
            token.rel = 'case'
          }

          if (uEq(token.rel, 'obl')
            && interp.isDative()
            && !node.children.some(x => uEq(x.node.rel, 'case'))
          ) {
            token.rel = 'iobj'
          }

          if (uEqSome(token.rel, ['det'])
            && udInterp.pos === 'DET'
            && interp.isCardinalNumeral()
          ) {
            if (token.interp.features.case === node.parent.node.interp.features.case) {
              token.rel = 'det:nummod'
            } else if ((interp.isNominative() || interp.isAccusative())
              && node.parent.node.interp.isGenitive()
            ) {
              token.rel = 'det:numgov'
            }
          }

          if (interp.isCardinalNumeral()
            && interp.isPronominal()
            && uEq(token.rel, 'nummod')
          ) {
            token.rel = 'det'
          }

          if (g.canBeDecimalFraction(node)
            && token.rel === 'nummod'
            && parent.interp.getFeature(f.Case) !== interp.getFeature(f.Case)
          ) {
            token.rel = 'nummod:gov'
          }

          if (g.isGoverning(token.rel)
            && token.interp.features.case === node.parent.node.interp.features.case
          ) {
            if (node.parent.children.some(x => x.node.interp.isPreposition()
              && x.node.interp.features.requiredCase as number === token.interp.features.case)
            ) {
              token.rel = udInterp.pos === 'DET'
                ? 'det:nummod'
                : 'nummod'
            }
          }

          if (interp.isAdjective() && uEq(token.rel, 'punct')) {
            token.rel = 'amod'
          }

          if (uEq(token.rel, 'discourse')
            && interp.lemma === 'це'
            && interp.isParticle()
            && node.parent.children.some(x => uEqSome(x.node.rel, ['nsubj', 'csubj']))
            && !parent.interp.isVerb()
            // && false
          ) {
            interp.resetFromVesumStr('noun:inanim:n:v_naz:&pron:dem', interp.lemma)
            token.rel = 'expl'
          }

          if (interp.hasPronominalType()
            && !interp.isParticle() // todo: separate :pers
          ) {
            interp.setIsPronoun()
          }

          if (!g.isGoverning(token.rel)
            && (uEq(token.rel, 'det')
              // || uEq(token.rel, 'amod')
            )
            // && !interp.isBeforeadj()
            // && !parent.interp.isForeign()
            // && !parent.isGraft
            // && !node.parent.children.some(x => uEq(x.node.rel, 'conj'))
            // && (interp.isNounish() || interp.isAdjective())
            && udInterp.pos === 'DET' && ['його', 'її', 'їх'].includes(interp.lemma)
            && !parent.interp.isXForeign()
            // && false
          ) {
            interp.features.case = parent.interp.features.case
            if (parent.interp.isPlural()) {
              interp.features.number = parent.interp.features.number
              interp.features.gender = undefined
            } else {
              interp.features.number = undefined
              if (parent.interp.features.gender) {
                interp.features.gender = parent.interp.features.gender
              }
            }
          }

          if (udInterp.pos === 'DET' && uEqSome(token.rel, ['amod', 'case'])) {
            token.rel = 'det'
          }

          if (udInterp.pos !== 'DET' && uEq(token.rel, 'det') && interp.isAdjective()) {
            token.rel = 'amod'
          }

          if (!interp.isAccusative() && (
            interp.features.grammaticalAnimacy !== undefined
            || interp.features.requiredAnimacy !== undefined)
          ) {
            interp.features.grammaticalAnimacy = undefined
            interp.features.requiredAnimacy = undefined
          }

          if (interp.isAbbreviation() && interp.lemma.endsWith('.')) {
            if (g2.isInflecable(interp.features.pos)) {
              interp.setIsUninflectable()
            } else {
              interp.setIsUninflectable(false)
            }
          }

          if (interp.isCardinalNumeral() && /\d$/.test(token.form)) {
            interp.setIsUninflectable()
          }

          if (interp.hasFeature(f.RequiredAnimacy) && !interp.isAccusative()) {
            interp.dropFeature(f.RequiredAnimacy)
          }

          if (g.isNegativeExistentialPseudosubject(node)) {
            node.node.rel = 'obj'
          }

          if (g.isQuantitativeAdverbModifierCandidate(node)) {
            token.rel = 'advmod:amtgov'
            if (node.parent.node.interp.isPlural()
              && interp.lemma === 'багато'
              && !parent.interp.isNoSingular()
            ) {
              interp.resetFromVesumStr('numr:p:v_naz:&pron:ind', 'багато')
              token.rel = 'nummod:gov'
            }
          }

          if (uEqSome(token.rel, ['obj'/* , 'iobj' */])
            // && parent.interp.isAdjective()
            && parent.interp.isVerbial()
            // && parent.interp.isReversive()
            && interp.isInstrumental()
          ) {
            // token.rel = 'obl'
            // console.log(token.id)
          }

          if (token.rel === 'xcomp' && !g.isInfinitiveAnalytically(node)) {
            token.rel = 'ccomp'
          }

          // ↓↓↓↓ breaks the tree, keep last!


          // switch compound numerals from flat to compound
          if (uEq(token.rel, 'nummod') /* || uEq(token.rel, 'amod') && interp.isOrdinalNumeral() */) {
            let flatChildren = node.children.filter(x => uEq(x.node.rel, 'flat'))
              .sort((a, b) => a.node.indexInSentence - b.node.indexInSentence)
            let newHead = _.last(flatChildren)
            // let flatChildren = node.children.filter(x => uEq(x.node.rel, 'flat'))
            if (newHead) {
              if (!newHead.node.interp.isCardinalNumeral()) {
                // throw new Error()
                console.error(`Not numeral ${newHead.node.id}`)
                continue
              }
              newHead.node.deps.forEach(x => {
                x.headId = node.parent.node.id
                x.relation = token.rel
              });
              [node, ...node.children].filter(x => x !== newHead)
                .forEach(x => x.node.deps.forEach(xx => {
                  xx.headId = newHead.node.id
                  if (x.node.interp.isCardinalNumeral()) {
                    xx.relation = 'compound'
                  }
                }))
            }
            continue
          }

          if (interp.isBeforeadj()
            && !node.isRoot()
            && !(uEq(token.rel, 'compound') && parent.interp.isBeforeadj())
            && !(uEq(token.rel, 'compound')
              && parent.interp.isAdjective()
              && token.indexInSentence < parent.indexInSentence)
          ) {
            // console.log(token)

            let middlers = node.children
              .map(x => x.node)
              .filter(x => x.rel === 'compound')
            if (middlers.length) {
              let newHead = middlers.pop()
              newHead.deps[0] = token.deps[0]
              nodes.filter(x => !x.isRoot() && x.node.deps[0].headId === token.id)
                .forEach(x => x.node.deps[0].headId = newHead.id)
              let toChange = [token, ...middlers]
              for (let [i, t] of toChange.entries()) {
                t.deps = [{ relation: 'compound', headId: newHead.id }]
                nodes[t.indexInSentence + 1].node.deps[0].headId = t.id
              }
            }
          }

          // if (interp.isUninflectable()) {
          //   let form = token.form
          //   if (interp.isAbbreviation() && interp.lemma.endsWith('.') && !form.endsWith('.')) {
          //     form = `${form}.`
          //   }
          //   if (form.toLowerCase() !== interp.lemma.toLowerCase()) {
          //     console.error(`form differs from lemma for :nv >> "${token.form}" #${token.id}`)
          //   }
          // }

          // if (token.indexInSentence > 0
          //   && !interp.isProper()
          //   && startsWithCapital(token.form)
          //   && !interp.isX()
          // ) {
          //   console.log(`велика літера без :prop, ${token2string(token)}`)
          // }

          // testMorpho(node, nextNode, analyzer)
        }


        // save to xml doc
        nodes.forEach(x => {
          // console.log(x)
          let element = id2el.get(x.node.id)
          if (element) {
            // console.log(x.node.form)
            saveToken(x.node, element)
          }
        })
      }



      let content = serializeMiDocument(root, true)
      // content = beautify(content, { indent_size: 2 })
      fs.writeFileSync(file, content)
    } catch (e) {
      console.error(`Error in file "${file}"`)
      throw e
    }
  }

  if (sequencePath) {
    fs.writeFileSync(sequencePath, idSequence)
  }
  console.log(`${tokenCount} tokens`)
}

//------------------------------------------------------------------------------
function saveToken(token: Token, element: AbstractElement) {
  Object.entries(token.getAttributes())
    .forEach(([k, v]) => element.setAttribute(k, v || undefined))

  let interp0 = element.firstElementChild()
  interp0.setAttribute('ana', token.interp.toVesumStr())
  interp0.setAttribute('lemma', token.interp.lemma)
  let dep = token.deps.map(x => `${x.headId}-${x.relation}`).join('|')
  if (dep) {
    element.setAttribute('dep', dep)
  }
}

//------------------------------------------------------------------------------
function id2str(n: number) {
  return n.toString(36).padStart(4, '0')
}

//------------------------------------------------------------------------------
function saveInterp(el: AbstractElement, interp: MorphInterp) {
  el.setAttribute('ana', interp.toVesumStr())
  el.setAttribute('lemma', interp.lemma)
}

//------------------------------------------------------------------------------
function renameStructures(root: AbstractElement) {
  // rename sentence boundaries
  mu(root.evaluateElements('//se'))
    .forEach(x => {
      x.insertAfter(root.document().createElement('sb'))
      x.remove()
    })

  // let elems = [...root.evaluateElements('chunk').filter(x => !x.ancestors().find(xx => xx.localName() === 'chunk'))]
  // elems.forEach(x => x)

  const DOC_META_ATTRS = [
    'src',
    'title',
    'author',
    'date',
  ]
  root.evaluateElements('//doc').forEach(doc =>
    DOC_META_ATTRS.forEach(attr =>
      !doc.attribute(attr) && doc.setAttribute(attr, '')))

}

//------------------------------------------------------------------------------
function testMorpho(node: GraphNode<Token>, nextNode: GraphNode<Token>, analyzer: MorphAnalyzer) {
  let token = node.node
  let interp = node.node.interp
  token.form = token.getForm()

  if (interp.isForeign()) {
    return
  }

  if (interp.isProper() && !strUtils.startsWithCapital(interp.lemma)) {
    // console.error(`lowercase lemma for proper "${token.form}" #${token.id}`)
    // interp.lemma = capitalizeFirst(interp.lemma)
  }

  // missing case
  if (g2.inflectsCase(interp.features.pos)
    && !interp.isBeforeadj()
    && !interp.isStem()
    && !interp.isForeign()
    && !interp.hasCase()
  ) {
    console.error(`no case in "${token.form}" #${token.id}`)
    interp.features.case = f.Case.nominative
  }

  // missing required case
  if (interp.isPreposition() && !interp.hasRequiredCase()) {
    console.error(`no case in prep "${token.form}" #${token.id}`)
  }

  // missing gender for adj
  if (interp.isAdjective() && !interp.isStem() && !interp.isForeign()) {
    if (!interp.hasGender() && !interp.hasNumber()) {
      console.error(`no gender/plural for ${token2string(node.node)}`)
    }
  }

  // missing gender for noun
  if (interp.isNounish()) {
    // missing gender for noun
    if (!interp.hasGender()
      && !g.GENDERLESS_PRONOUNS.includes(interp.lemma) && !(
        interp.isNoSingular() || interp.isSingular() && interp.features.person === 1
      )
    ) {
      // console.error(`no gender for ${token2string(node.node)}`)
    }
  }

  // missing animacy
  if (interp.isNounish() && !interp.hasAnimacy()
    && !g.EMPTY_ANIMACY_NOUNS.includes(interp.lemma)
    && !(interp.features.pronominalType === f.PronominalType.personal
      && interp.features.person === 3
    )
  ) {
    console.error(`no animacy for ${token2string(node.node)}`)
  }

  // missing in dict
  if (!interp.isStem()  // temp
    && !interp.isPunctuation()  // temp
    // && !interp.isBeforeadj()  // temp
    && !interp.lemma.includes('-')  // temp
  ) {
    let interpsFromDict = analyzer.tag(token.form, nextNode && nextNode.node.form)

    let closestFixable = findClosestFixable(token.interp, interpsFromDict)
    if (closestFixable) {
      token.interp = closestFixable
    } else if (canBeNameFromCommon(token.interp, interpsFromDict)) {
      // console.error(`canBeNameFromCommon`)
    } else {
      let interpsFromDictStr = interpsFromDict.map(x => `${x.toVesumStr()}@${x.lemma}`)
      let message = `>>> interp not in dict: ${
        token2stringRaw(token.id, token.form, token.interp.lemma, token.interp.toVesumStr())}`
      if (interpsFromDictStr.length) {
        // message += ` dict:\n${interpsFromDictStr.slice(0, 10).join('\n' )}\n=========`
      }
      console.log(message)
    }
  }
}

//------------------------------------------------------------------------------
const DROP_ORDER = [
  f.ParadigmOmonym,
  f.Auto,
  f.Typo,
  f.Formality,

  f.Alternativity,
  f.Badness,
  f.Colloquiality,
  f.Foreign,
  f.Formality,
  f.N2adjness,
  f.Oddness,
  f.Rarity,
  f.Slang,
  f.VuAlternativity,

  f.NounNumeral,

  f.NounType,
  f.Degree,
  f.Pronoun,
  f.Polarity,
  f.VerbReversivity,
  f.Reflexivity,
  f.PartType,
  f.Inflectability,
  f.Abbreviation,
  f.PrepositionRequirement,

  f.NumberTantum,
  f.OrdinalNumeral,
  f.RequiredAnimacy,

  // f.Pos,
]
//------------------------------------------------------------------------------
function findClosestFixable(inCorp: MorphInterp, inDict: MorphInterp[]) {
  let paradigmOmonym = inCorp.getFeature(f.ParadigmOmonym)

  let inCorp2 = inCorp.clone().dropFeature(f.ParadigmOmonym)
  let inDict2 = inDict.map(x => x.clone().dropFeature(f.ParadigmOmonym))

  if (inCorp.isCardinalNumeral()) {  // one-time thing
    inCorp2.dropFeature(f.MorphNumber)
  }

  for (let [i, feature] of DROP_ORDER.entries()) {
    inCorp2.dropFeature(feature)
    inDict2.forEach(x => x.dropFeature(feature))
    let index = inDict2.findIndex(x => inCorp.isAdjectiveAsNoun()
      ? x.featurewiseEquals(inCorp2)
      : x.equals(inCorp2))
    if (index >= 0) {
      if (i > 3) {
        let ret = inDict[index].setFeature(f.ParadigmOmonym, paradigmOmonym)
        if (inCorp.isAdjectiveAsNoun()) {
          ret.lemma = inCorp.lemma
        }
        return ret
      }
      return inCorp
    }
  }
}

//==============================================================================
const ALLOWED_TO_BE_EMPTY = ['g', 'sb', 'gap', 'br']
function killEmptyElements(root: AbstractElement) {
  mu(root.evaluateElements(`//*[not(normalize-space())]`))
    .filter(x => !ALLOWED_TO_BE_EMPTY.includes(x.localName()))
    .toArray()
    .forEach(x => x.remove())
}

//------------------------------------------------------------------------------
function insertSb(root: AbstractElement) {
  let firstWs = mu(root.evaluateElements('//doc'))
    .map(x => x.evaluateElement('.//w_')).flatten()
  for (let firstW of firstWs) {
    // walkUpUntil()
    let prev = firstW.previousElementSibling()
    if (!prev || prev.localName() !== 'sb') {
      firstW.insertBefore(firstW.document().createElement('sb'))
    }
  }
}

//------------------------------------------------------------------------------
function swapSb(root: AbstractElement) {
  for (let sb of [...root.evaluateElements('//sb')]) {
    let next = sb.nextElementSibling()
    if (next && next.localName() === 'g') {
      next.insertAfter(sb)
    }
  }
}

//------------------------------------------------------------------------------
function cloneAsBareAdjective(fromInterp: MorphInterp) {
  return fromInterp.cloneWithFeatures([f.Gender, f.MorphNumber, f.Case])
    .setLemma(fromInterp.lemma.toLowerCase())
}

//------------------------------------------------------------------------------
function cloneAsBareNoun(fromInterp: MorphInterp) {
  return fromInterp.cloneWithFeatures([f.Animacy, f.Gender, f.MorphNumber, f.Case])
  // .setLemma(fromInterp.lemma.toLowerCase())
}

//------------------------------------------------------------------------------
function createInterpWithFeatures(fromInterp: MorphInterp, features: any[]) {
  let ret = new MorphInterp()
  for (let feature of features) {
    ret.setFeature(feature, fromInterp.getFeature(feature))
  }

  return ret
}

//------------------------------------------------------------------------------
function canBeNameFromCommon(inCorp: MorphInterp, inDict: MorphInterp[]) {
  let inCorp2 = cloneAsBareAdjective(inCorp)
  let inDict2 = inDict.map(x => cloneAsBareAdjective(x))
  if (inDict2.some(x => x.equals(inCorp2))) {
    return true
  }

  inCorp2 = cloneAsBareNoun(inCorp)
  inDict2 = inDict.map(x => cloneAsBareNoun(x))
  if (inDict2.some(x => x.equals(inCorp2))) {
    return true
  }

  inCorp2.setIsAnimate(false)
  inDict2.forEach(x => x.setIsAnimate(false))
  if (inDict2.some(x => x.equals(inCorp2))) {
    return true
  }

  return false
}

//------------------------------------------------------------------------------
function autofixXml(files: string[]) {
  for (let filePath of files) {
    let xmlstr = fs.readFileSync(filePath, 'utf8')
    xmlstr = autofixSomeEntitites(xmlstr)
    xmlstr = removeNamespacing(xmlstr)
    fs.writeFileSync(filePath, xmlstr)
  }
}

//------------------------------------------------------------------------------
// function isIncompleteNoun(interp: MorphInterp) {
//   return
//   interp.features.gender === undefined && !(
//     interp.isNoSingular()
//   )
//     || interp.features.animacy === undefined && !(
//       interp.features.pronominalType === f.PronominalType.personal
//       && interp.features.person === 3
//     )
// }

//------------------------------------------------------------------------------
function token2stringRaw(id: string, form: string, lemma: string, tag: string) {
  return `#${id} ${form} @ ${lemma} @@ ${tag}`
}

//------------------------------------------------------------------------------
function token2string(token: Token) {
  return token2stringRaw(token.id, token.form, token.interp.lemma, token.interp.toVesumStr())
}

//------------------------------------------------------------------------------
function insertGlueIfNeeded(el: AbstractElement) {
  if (el.firstElementChild().text() === ','
    && el.previousElementSibling()
    // && el.nextElementSibling()
    && el.previousElementSibling().localName() !== 'g'
    // && el.nextElementSibling().localName() !== 'g'
    // && /\d+/.test(el.previousElementSibling().firstElementChild().text())
    // && /\d+/.test(el.nextElementSibling().firstElementChild().text())
  ) {
    el.insertBefore(el.document().createElement('g'))
    // el.insertAfter(el.document().createElement('g'))
  }
}

//------------------------------------------------------------------------------
function splitFractions(tokens: AbstractElement[], idSequence: number) {
  for (let token of tokens) {
    let interpEl = token.firstElementChild()
    let form = interpEl.text()
    let match = form.match(/^(\d+)([\.,])+(\d+)$/)
    if (match) {
      let [, intPart, punct, fracPart] = match
      interpEl.text(intPart)
      interpEl.setAttribute('lemma', intPart)

      let punctElId = id2str(idSequence++)
      let fracElId = id2str(idSequence++)


      let fracEl = token.document().createElement('w_').setAttributes({
        id: fracElId,
        dep: `${token.attribute('id')}-compound`
      }) as AbstractElement
      let fracInterpEl = token.document().createElement('w').setAttributes({
        lemma: fracPart,
        ana: interpEl.attribute('ana'),
      })
      fracInterpEl.text(fracPart)
      fracEl.appendChild(fracInterpEl)
      token.insertAfter(fracEl)


      let punctEl = token.document().createElement('w_').setAttributes({
        id: punctElId,
        dep: `${fracElId}-punct`
      }) as AbstractElement
      let punctInterpEl = token.document().createElement('w').setAttributes({
        lemma: punct,
        ana: 'punct',
      })
      punctInterpEl.text(punct)
      punctEl.appendChild(punctInterpEl)
      token.insertAfter(punctEl)
    }
  }

  return idSequence
}

//------------------------------------------------------------------------------
async function addDocMeta(root: AbstractElement) {
  for (let docEl of root.evaluateElements('//doc')) {
    let attributes = docEl.attributesObj()
    if (!attributes.src) {
      continue
    }

    if (!attributes.author || !attributes.date) {
      if (attributes.src.includes('facebook.com')) {
        // let meta = await getFbPostMeta(attributes.src)
        // console.log(meta)
        // attributes = { ...attributes, ...meta }
      } else if (attributes.src.includes('tereveni.org')) {
        let html = await fetchText(attributes.src)
        let meta = mu(tereveni.streamDocs(html)).find(x => x.url === attributes.src)
        console.log(meta)
        attributes.author = meta.author
        attributes.date = meta.date
        attributes.title = meta.title
      }
    }
    docEl.setAttributes(attributes)
  }
}

//------------------------------------------------------------------------------
async function getFbPostMeta(url: string) {
  let html = await fetchText(url)
  console.log(html.substr(0, 100))
  let author = strUtils.singleMatchOrThrow(html, /ownerName:"(.+?)",/, 1)
  let dateStr = strUtils.singleMatchOrThrow(html, /data-utime="(\d+)"/, 1)
  let date = toSortableDatetime(fromUnixStr(dateStr))
  return { author, date }
}


const TRANSFORMS = {
  toObl(t: GraphNode<Token>) {
    t.node.rel = 'obl'
  },
}

////////////////////////////////////////////////////////////////////////////////
if (require.main === module) {
  main()
}
