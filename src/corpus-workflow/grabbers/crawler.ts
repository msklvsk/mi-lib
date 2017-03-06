import { join } from 'path'
import { exec } from 'child_process'
import { moveCursor } from 'readline'
import { FileSavedSet } from '../../file_saved_set.node'
import { FolderSavedMap } from '../../folder_saved_map.node'
import { fetchText } from './utils'
import { parseHtml } from '../../xml/utils.node'
import { matchAll, sleep } from '../../lang'
import { resolve, parse, Url } from 'url'
import { AbstractElement } from 'xmlapi'


// export type LinkExtractor = (html: string) => string[]
export type LinkExtractor = (root: AbstractElement) => string[]
export type StringPredicate = (value: string) => any
export type UrlPredicate = (value: Url) => any

////////////////////////////////////////////////////////////////////////////////
export class Crawler {
  private saved: FolderSavedMap
  private visited: FileSavedSet<string>
  private failed: FileSavedSet<string>
  private visiting = new Set<string>()

  private isUrlToSave: UrlPredicate
  private isUrlToFollow: UrlPredicate[]

  private followUrlsExtractor: LinkExtractor
  private saveUrlsExtractor: LinkExtractor

  private timeout = 0
  private numRetries = 5

  constructor(workspacePath: string) {
    this.visited = new FileSavedSet(join(workspacePath, 'processed'))
    this.failed = new FileSavedSet(join(workspacePath, 'failed'))
    this.saved = new FolderSavedMap(join(workspacePath, 'saved'), '**/*.html')
    // this.saved = new FolderSavedMap(join(workspacePath, 'saved'), '**/*.html')
    // console.log(this.saved)
  }

  setUrlsToSave(pred: UrlPredicate) {
    this.isUrlToSave = pred
    return this
  }

  setUrlsToFollow(pred: UrlPredicate[]) {
    this.isUrlToFollow = pred
    return this
  }

  async seed(urlStrs: string[]) {
    for (let urlStr of urlStrs) {
      let url = parse(urlStr)
      let fileishUrl = `${url.hostname}${url.path}`
      if (!fileishUrl.endsWith('.html')) {
        fileishUrl = fileishUrl.endsWith('/') ? `${fileishUrl}index.html` : `${fileishUrl}.html`
      }
      if (this.visited.has(urlStr)
        || this.visiting.has(urlStr)
        || this.saved.has(fileishUrl)
        || this.failed.has(urlStr)
        // || urlStr.startsWith('http://ukr')
      ) {
        return
      }
      this.visiting.add(urlStr)

      process.stderr.write(`processing ${urlStr} `)
      let content: string
      if (this.isUrlToSave(url) && this.saved.has(fileishUrl)) {
        process.stderr.write(` skipped\n`)
      } else {
        try {
          await sleep(this.timeout / 2 + Math.random() * this.timeout)
          // process.stderr.write(`fetching `)
          // let timeout = setTimeout(() => exec(`say 'Stupid website!' -v Karen`), 2000)
          content = await Promise.race([fetchText(urlStr), sleep(1000)])
          for (let i = 0; !content && i < this.numRetries; ++i) {
            await sleep(500)
            process.stderr.write(` retrying`)
            content = await Promise.race([fetchText(urlStr), sleep(2000)])
          }
          if (!content) {
            // exec(`say 'auch!' -v Karen`)
            process.stderr.write(` ✖️\n`)
            this.failed.add(urlStr)
            return
          }
          // clearTimeout(timeout)
        } catch (e) {
          console.error(`error fetching ${urlStr}`)
          return
        }

        if (url && this.isUrlToSave(url)) {
          this.saved.set(fileishUrl, content)
          process.stderr.write(` ✔\n`)
        } else {
          process.stderr.write(` fetched \n`)
        }
      }


      // let root = parseHtml(content)
      // let hrefToFollow = this.followUrlsExtractor(root)
      //   .map(x => parse(resolve(urlStr, x)))
      //   .filter(x => x.hostname === url.hostname)

      let urls = extractHrefs(content).map(x => parse(resolve(urlStr, x)))
      let urlsToSave = urls.filter(x => x && this.isUrlToSave(x))
      let urlsToFollow = urls.filter(x => x && this.isUrlToFollow.some(xx => xx(x)))
        .sort((a, b) =>
          (this.isUrlToFollow.findIndex(x => x(a)) - this.isUrlToFollow.findIndex(x => x(b)))
          || (a > b ? 1 : (a === b ? 0 : -1))
        )

      for (let { href } of urlsToSave) {
        await this.seed([href])
      }
      for (let { href } of urlsToFollow) {
        await this.seed([href])
      }

      this.visited.add(urlStr)
      // console.log(`fully processed ${urlStr}`)
    }
  }
}

//------------------------------------------------------------------------------
function extractHrefs(html: string) {
  return matchAll(html, /<\s*a\b[^>]+\bhref="([^"]+)"/g)
    .map(x => x[1])
    .filter(x => x.startsWith('http') || !/^\w+:/.test(x))
}