#!/usr/bin/env node

import * as fs from 'fs'
import * as path from 'path'
import { parseXmlFileSync } from '../../xml/utils.node'
import { tei2tokenStream, tokenStream2sentences } from '../../nlp/utils'
import { last } from '../../lang'
import { Token } from '../../nlp/token'
import { sentence2conllu } from './utils'
import { mu } from '../../mu'
import { validateSentenceSyntax } from './validation'

import * as glob from 'glob'
import * as minimist from 'minimist'
import * as mkdirp from 'mkdirp'
import * as columnify from 'columnify'



interface Args {
  _: string[]
  noStandartizing: boolean
  onlyValid: boolean
  reportHoles: boolean
  validate: boolean
  oneSet: string
}

class Dataset {
  file: number
  counts = {
    kept: 0,
    exported: 0,
  }
  newdoc = false
}

//------------------------------------------------------------------------------
function main() {
  let args: Args = minimist(process.argv.slice(2), {
    boolean: [
      'validate',
      'noStandartizing',
      'onlyValid',
      'reportHoles',
    ],
    alias: {
      noStandartizing: ['no-std'],
      onlyvalid: 'only-valid',
      oneSet: 'one-set',
    },
    default: {
      oneSet: 'train',
      noStandartizing: false,
    }
  }) as any

  let [globStr, outDir] = args._
  let roots = mu(glob.sync(globStr)).map(x => ({ root: parseXmlFileSync(x), basename: path.basename(x) }))
  mkdirp.sync(outDir)

  let openedFiles = {} as any
  let datasetRegistry = {} as { [name: string]: Dataset }
  for (let {root, basename} of roots) {
    let tokenStream = tei2tokenStream(root)
    let sentenceStream = mu(tokenStream2sentences(tokenStream))
    for (let {sentenceId, set, tokens, newParagraph, newDocument } of sentenceStream) {
      initSyntax(tokens)
      let hasSyntax = tokens.some(x => x.hasSyntax())
      if (!hasSyntax) {
        continue
      }

      set = args.oneSet || set || 'train'
      datasetRegistry[set] = datasetRegistry[set] || new Dataset()
      if (newDocument) {
        Object.values(datasetRegistry).forEach(x => x.newdoc = true)
      }

      let numWords = mu(tokens).count(x => !x.interp.isPunctuation())
      let numRoots = mu(tokens).count(x => !x.relation)
      if (!numRoots) {
        datasetRegistry[set].counts.kept += numWords
        console.error(formatProblems(basename, sentenceId, tokens, [{ message: 'cycle' }]))
        continue
        // } else if (numRoots > 1 && args.reportHoles) {
        //   console.error(formatProblems(basename, sentenceId, tokens, [{ message: 'речення недороблене' }]))
      }

      if (!args.noStandartizing) {
        standartizeSentence2ud20(tokens)
      }

      let problems = validateSentenceSyntax(tokens)
      if (problems.length && args.validate) {
        console.error(formatProblems(basename, sentenceId, tokens, problems))
      }

      if (problems.length && args.onlyValid) {
        datasetRegistry[set].counts.kept += numWords
      } else if (numRoots > 1) {
        datasetRegistry[set].counts.kept += numWords
      } else {
        datasetRegistry[set].counts.exported += numWords

        let filename = set2filename(outDir, set)
        let file = openedFiles[filename] = openedFiles[filename] || fs.openSync(filename, 'w')
        let conlluedSentence = sentence2conllu(tokens, sentenceId, newParagraph, datasetRegistry[set].newdoc)
        fs.writeSync(file, conlluedSentence + '\n\n')
        datasetRegistry[set].newdoc = false
      }
    }
  }

  let stats = Object.entries(datasetRegistry).map(([set, {counts: {kept, exported}}]) => ({ set, kept, exported }))
  stats.push({ set: 'TOTAL', kept: stats.map(x => x.kept).reduce((a, b) => a + b, 0), exported: stats.map(x => x.exported).reduce((a, b) => a + b, 0) })

  console.error(`\n`)
  console.error(columnify(stats, {
    config: {
      kept: {
        align: 'right',
      },
      exported: {
        align: 'right',
      },
    },
  }))
  console.error(`\n`)
}

if (require.main === module) {
  main()
}

//------------------------------------------------------------------------------
function formatProblems(docName: string, sentenceId: string, tokens: Token[], problems: any[]) {
  let bratPath = tokens.find(x => x.getAttribute('depsrc')).getAttribute('depsrc').slice('/Users/msklvsk/Desktop/treebank/'.length, -4)
  let href = `https://lab.mova.institute/syntax_annotator/index.xhtml#/treebank/ud2/${bratPath}`
  let ret = `*** Проблеми в реченні ${sentenceId} ${href}\n\n`
  let repro = tokens.join(' ')
  for (let [i, {index, message}] of problems.entries()) {
    ret += `    ${message}\n`
    ret += `${repro}\n`
    if (index !== undefined) {
      ret += `${' '.repeat(calculateTokenOffset(index, tokens))}${'^'.repeat(tokens[index].form.length)}\n`
    }
  }
  ret += '\n'
  return ret
}

//------------------------------------------------------------------------------
function calculateTokenOffset(index: number, tokens: Token[]) {
  let ret = 0
  for (let i = 0; i < index; ++i) {
    ret += tokens[i].form.length + 1
  }
  return ret
}

//------------------------------------------------------------------------------
function set2filename(dir: string, setName: string) {
  return path.join(dir, `uk-ud-${setName}.conllu`)
}

//------------------------------------------------------------------------------
function initSyntax(sentence: Array<Token>) {
  let id2i = {} as any
  for (let i = 0; i < sentence.length; ++i) {
    id2i[sentence[i].getAttribute('n')] = i
  }
  sentence.forEach(token => {
    token.head = id2i[token.head]
  })
}

//------------------------------------------------------------------------------
function standartizeSentence2ud20(sentence: Array<Token>) {
  let lastToken = last(sentence)
  let rootIndex = sentence.findIndex(x => !x.relation)

  for (let token of sentence) {
    let interp = token.interp

    // set AUX
    if (['aux', 'cop'].includes(token.relation)) {
      interp.setIsAuxillary()
    }

    // set the only iobj to obj
    if (token.relation === 'iobj' && !sentence.some(tt => tt.head === token.head && tt.relation === 'obj')) {
      token.relation = 'obj'
    }
  }

  // set parataxis punct to the root
  let thecase = lastToken.interp.isPunctuation() && sentence[lastToken.head] && sentence[lastToken.head].relation === 'parataxis'
  if (thecase) {
    lastToken.head = rootIndex
  }
}



/*

autofix
cc/punct
obl:agent


*/
