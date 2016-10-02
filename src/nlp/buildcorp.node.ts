import * as path from 'path'
import { basename } from 'path'
import * as fs from 'fs'
import { WriteStream, createWriteStream } from 'fs'
import * as readline from 'readline'
import { execSync } from 'child_process'
import * as minimist from 'minimist'
import { parseHtmlString } from 'libxmljs'

import { LibxmljsDocument } from 'xmlapi-libxmljs'
import * as nlpUtils from '../nlp/utils'
import { createMorphAnalyzerSync } from './morph_analyzer/factories.node'
import { MorphAnalyzer } from './morph_analyzer/morph_analyzer'
import { filename2lxmlRootSync } from '../utils.node'
import { indexTableByColumns, unique } from '../algo'
import { createObject2, arrayed } from '../lang'
import { mu } from '../mu'
import { getLibRootRelative } from '../path.node'
import { keyvalue2attributes } from '../xml/utils'
import { parseUmolodaArticle } from './parsers/umoloda'
import { parseDztArticle } from './parsers/dzt'


const globSync = require('glob').sync
const mkdirp = require('mkdirp')
const args = minimist(process.argv.slice(2), {
  boolean: ['xml', 'novert'],
  string: [],
  alias: {
    'workspace': ['ws'],
  },
})



buildCorpus(args as any)
// buildCorpus2(args)



interface Args {
  input: string[]
  workspace: string
  meta?: string[]
  xml: boolean
  novert: boolean
  vertfile: string
}

function normalizeArgs(params) {
  params.workspace = Array.isArray(params.workspace) ?
    params.workspace[params.workspace.length - 1] : params.workspace
  params.input = arrayed(params.input)
  params.meta = arrayed(params.meta)
}

function trimExtension(filename: string) {
  let dotIndex = filename.lastIndexOf('.')
  return dotIndex < 0 ? filename : filename.substr(0, dotIndex)
}

function docCreator(xmlstr: string) {
  return LibxmljsDocument.parse(xmlstr)
}

function htmlDocCreator(html: string) {
  return new LibxmljsDocument(parseHtmlString(html))
}

function numDigits(integer: number) {
  return Math.floor(Math.log10(integer)) + 1
}

function zeropad(value: number, max: number) {
  let numZeroes = numDigits(max) - numDigits(value)
  if (numZeroes > 0) {
    return '0'.repeat(numZeroes) + value
  }
  return value.toString()
}

function separatedValues2Objects(fileStr: string, separator: string): any[] {
  let [headerString, ...lines] = fileStr.split('\n')
  let header = headerString.split(separator)
  return lines.map(x => createObject2(header, x.split(separator)))
}

function countOf(i: number, len: number) {
  return `(${zeropad(i + 1, len)} of ${len})`
}

function prepareMetadataFiles(filePaths: string[]) {
  let rows = []
  for (let filePath of filePaths) {
    let fileStr = fs.readFileSync(filePath, 'utf8')
    rows.push(...separatedValues2Objects(fileStr, '\t'))
  }
  return indexTableByColumns(rows, ['filename']) as Map<string, any>
}

function prepareDocMeta(meta) {
  for (let key of Object.keys(meta)) {
    if (!key.trim().length || !meta[key].trim().length) {
      delete meta[key]
    } else {
      if (key === 'text_type') {
        meta[key] = createTextTypeAttribute(meta[key])
      } else {
        meta[key] = meta[key].trim()
      }
    }
  }
  // delete meta.filename
  return meta
}



function createTextTypeAttribute(value: string) {
  // todo: wut? try moving it to global scope
  const textTypeTree = {
    'автореферат': ['наука'],
    'стаття': ['публіцистика'],
    'науково-популярний': ['наука'],
  }

  let res = new Array<string>()
  for (let type of value.split('|')) {
    let leafAddress = textTypeTree[type]
    if (leafAddress) {
      for (let i of leafAddress.keys()) {
        let typePath = leafAddress.slice(0, i + 1).join('::')
        res.push(typePath)
      }
      res.push([...leafAddress, value].join('::'))
    } else {
      res.push(type)
    }
  }
  return res.join('|')
}

function createVerticalFile(params: Args) {
  if (params.vertfile) {
    return fs.openSync(params.vertfile, 'a')
  } else {
    let filePath
    let i = 1
    do {
      filePath = path.join(params.workspace, `corpus.${i++}.vertical.txt`)
    } while (fs.existsSync(filePath))

    mkdirp.sync(params.workspace)
    return fs.openSync(filePath, 'w')
  }
}

function readIdsFromVertical(filePath: string) {
  return new Promise<string[]>((resolve) => {
    let res = new Array<string>()
    readline.createInterface({ input: fs.createReadStream(filePath) })
      .on('line', (line: string) => {
        let match = line.match(/^<doc(?: filename="([^"]+)"/)
        if (match) {
          res.push(match[1])
        }
      }).on('close', () => resolve(res))
  })
}

async function buildCorpus(params: Args) {
  normalizeArgs(args)
  // let isDoingIo = false


  // read already generated ids
  let skipIdSet = new Set<string>()
  if (params.vertfile) {
    process.stdout.write(`reading ids from "${params.vertfile}"`)
    skipIdSet = new Set(await readIdsFromVertical(params.vertfile))
    process.stdout.write(`, ${skipIdSet.size} read\n`)
  }

  // console.log(params.meta)
  let metaTable = prepareMetadataFiles(params.meta)
  let verticalFile = createVerticalFile(params)
  let analyzer = createMorphAnalyzerSync().setExpandAdjectivesAsNouns(false).setKeepN2adj(true)
  let idRegistry = new Set<string>()

  // kontrakty('/Users/msklvsk/Downloads/KONTRAKTY/', analyzer, verticalFile)
  // umoloda(params.workspace, analyzer, verticalFile)
  // dzt(params.workspace, analyzer, verticalFile)
  // return
  let inputFiles: string[] = mu(params.input).map(x => globSync(x)).flatten().toArray()
  inputFiles = unique(inputFiles)
  let taggedDir = path.join(params.workspace, 'tagged')
  if (params.xml) {
    mkdirp.sync(taggedDir)
  }
  for (let [i, filePath] of inputFiles.entries()) {
    try {
      let basename = path.basename(filePath)
      let id = trimExtension(basename)

      if (idRegistry.has(id)) {
        console.error(`WARNING: id "${id}" used already, skipping ${filePath}`)
        continue
      }

      let dest = path.join(taggedDir, id + '.xml')
      let root
      process.stdout.write(`${countOf(i, inputFiles.length)} ${id}:`)
      if (fs.existsSync(dest)) {
        if (params.novert) {
          process.stdout.write(` tagged already, skipping xml and vertical\n`)
          continue
        }
        if (skipIdSet.has(id)) {
          process.stdout.write(` already present in vertical, skipping\n`)
          continue
        }
        process.stdout.write(` tagged already, reading from xml`)
        root = filename2lxmlRootSync(dest)
      } else {
        process.stdout.write(` preprocessing`)
        let body = fs.readFileSync(filePath, 'utf8')
        let isXml = path.extname(basename) === '.xml'
        root = nlpUtils.preprocessForTaggingGeneric(body, docCreator, isXml)

        process.stdout.write(`; tokenizing`)
        nlpUtils.tokenizeTei(root, analyzer)

        if (params.xml) {
          process.stdout.write(`; tagging`)
          nlpUtils.morphInterpret(root, analyzer)

          process.stdout.write(`; writing xml`)
          fs.writeFileSync(dest, root.document().serialize(true), 'utf8')
        }
      }

      if (!params.novert) {
        process.stdout.write(`; creating vertical`)
        let meta = metaTable && metaTable.get(id)
        if (!meta) {
          process.stdout.write(`: 😮  no meta`)
          meta = {}
        } else {
          prepareDocMeta(meta)
        }
        meta.filename = id
        if (params.xml) {
          var verticalLines = [...nlpUtils.interpretedTeiDoc2sketchVertical(root, meta)]
        } else {
          verticalLines = [...nlpUtils.tokenizedTeiDoc2sketchVertical(root, analyzer, meta)]
        }
        process.stdout.write(`: writing`)
        fs.writeSync(verticalFile, verticalLines.join('\n') + '\n')
      }

      process.stdout.write('\n')
    } catch (e) {
      process.stdout.write(`\n ⚡️⚡️ ❌  ${e.message}`)
    }
  }
}


function buildCorpus2(args: minimist.ParsedArgs) {
  let analyzer = createMorphAnalyzerSync().setExpandAdjectivesAsNouns(false).setKeepN2adj(true)

  const djangoScriptPath = '/Users/msklvsk/Developer/mova-institute/dbgui/get_all_texts.py'

  // let metadata = JSON.parse(execSync(djangoScriptPath, { encoding: 'utf8' }))

  // kontrakty('/Users/msklvsk/Downloads/KONTRAKTY/', analyzer)
}

//------------------------------------------------------------------------------
function umoloda(workspacePath: string, analyzer: MorphAnalyzer, verticalFile: number) {
  let articlePathsGLob = workspacePath + 'umoloda/fetched_articles/*.html'
  let articlePaths = globSync(articlePathsGLob).sort(umolodaFilenameComparator)
  for (let path of articlePaths) {
    let [a, b, c] = trimExtension(basename(path)).split('_')
    console.log(`processing umoloda article ${a}_${b}_${c}`)

    let html = fs.readFileSync(path, 'utf8')
    let { title, author, paragraphs, date } = parseUmolodaArticle(html, htmlDocCreator)

    if (!paragraphs.length) {  // some empty articles happen
      continue
    }

    date = date.split('.').reverse().join('–')
    let meta = {
      publisher: 'Україна молода',
      proofread: '+',
      href: `http://www.umoloda.kiev.ua/number/${a}/${b}/${c}/`,
      author,
      title,
      date,
      text_type: 'публіцистика::стаття',
    }

    fs.writeSync(verticalFile, `<doc ${keyvalue2attributes(meta)}>\n`)
    for (let p of paragraphs) {
      fs.writeSync(verticalFile, '<p>\n')
      let stream = nlpUtils.string2tokenStream(p, analyzer)
        .map(x => nlpUtils.token2sketchVertical(x))
        .chunk(10000)
      stream.forEach(x => fs.writeSync(verticalFile, x.join('\n') + '\n'))
      fs.writeSync(verticalFile, '</p>\n')
    }
    fs.writeSync(verticalFile, `</doc>\n`)
  }
}

//------------------------------------------------------------------------------
function dzt(workspacePath: string, analyzer: MorphAnalyzer, verticalFile: number) {
  let articlePathsGLob = workspacePath + 'dzt/fetched_articles/**/*.html'
  let articlePaths = globSync(articlePathsGLob)  // todo: sort by date

  for (let path of articlePaths) {
    console.log(`processing dzt article ${trimExtension(basename(path))}`)

    let html = fs.readFileSync(path, 'utf8')
    let { title, author, paragraphs, datetime, url } = parseDztArticle(html, htmlDocCreator)

    if (!paragraphs.length) {  // some empty articles happen
      continue
    }

    let meta = {
      publisher: 'Дзеркало тижня',
      proofread: '+',
      href: url,
      author,
      title,
      date: datetime,
      text_type: 'публіцистика::стаття',
    }

    fs.writeSync(verticalFile, `<doc ${keyvalue2attributes(meta)}>\n`)
    for (let p of paragraphs) {
      fs.writeSync(verticalFile, '<p>\n')
      let stream = nlpUtils.string2tokenStream(p, analyzer)
        .map(x => nlpUtils.token2sketchVertical(x))
        .chunk(10000)
      stream.forEach(x => fs.writeSync(verticalFile, x.join('\n') + '\n'))
      fs.writeSync(verticalFile, '</p>\n')
    }
    fs.writeSync(verticalFile, `</doc>\n`)
  }
}

//------------------------------------------------------------------------------
function kontrakty(folderPath: string, analyzer: MorphAnalyzer, verticalFile: number) {
  let files = globSync(folderPath + '*.txt')
  for (let file of files) {
    console.log(`processsing ${path.basename(file)}…`)
    let year = Number.parseInt(path.basename(file).replace(/\.txt$/, ''))
    let contents = fs.readFileSync(file, 'utf8')
    contents = nlpUtils.normalizeCorpusTextString(contents)

    let stream = nlpUtils.string2tokenStream(contents, analyzer)
      .map(x => nlpUtils.token2sketchVertical(x))
      .chunk(10000)

    let meta = {
      publisher: 'Галицькі контракти',
      title: `Контракти ${year}`,
      year_created: year,
      text_type: 'публіцистика',
    }
    fs.writeSync(verticalFile, `<doc ${keyvalue2attributes(meta)}>\n`)
    stream.forEach(x => fs.writeSync(verticalFile, x.join('\n') + '\n'))
    fs.writeSync(verticalFile, `</doc>\n`)
  }
}

//------------------------------------------------------------------------------
function umolodaFilenameComparator(a: string, b: string) {
  return Number(trimExtension(basename(a)).split('_')[2]) -
    Number(trimExtension(basename(b)).split('_')[2])
}
