import { writePromiseDrain, writeBackpressing } from './stream_utils.node'
import { mu } from './mu'

import { readFileSync } from 'fs'
import * as fs from 'fs'
import * as path from 'path'
import { createInterface } from 'readline'
import { sync as mkdirpSync } from 'mkdirp'
import { promisify } from 'util'

const lineIterator = require('n-readlines')

const readFile = promisify(fs.readFile)


////////////////////////////////////////////////////////////////////////////////
// export async function* lines(readable: NodeJS.ReadableStream, newline: string | RegExp = '\n') {
//   let leftover: string
//   for await (let chunk of new StreamDataIterator<string>(readable)) {
//     let splitted = chunk.split(newline)
//     leftover = splitted.pop()
//     yield* splitted
//   }
//   yield leftover
// }

////////////////////////////////////////////////////////////////////////////////
// export function linesCbNonempty(
//   readable: NodeJS.ReadableStream,
//   callback: (lineBulk: string[], ready: () => void) => void,
//   newline: string | RegExp = '\n'
// ) {
//   linesCb(readable, (line, ready) => {
//     if (line) {
//       callback(line, ready)
//     } else {
//       ready()
//     }
//   }, newline)
// }
////////////////////////////////////////////////////////////////////////////////
export function lineBulksAsync(  // todo: rerwrite with async iterators once avail
  readable: NodeJS.ReadableStream,
  callback: (lineBulk: string[]) => void,
  newline: string | RegExp = '\n'
) {
  return new Promise<void>((resolve, reject) => {
    let leftover = ''

    const consumer = async (chunk: string) => {
      let splitted = (leftover + chunk).split(newline)
      if (splitted.length === 1) {
        leftover = splitted[0]
      } else if (splitted.length) {
        leftover = splitted.pop()
        readable.pause()
        try {
          await callback(splitted)
        } catch (e) {
          return reject(e)
        }
        readable.resume()
      }
    }

    readable
      .on('error', reject)
      .on('data', consumer)
      .on('end', async () => {
        await callback([leftover])
        resolve()
      })
  })
}

////////////////////////////////////////////////////////////////////////////////
export function linesAsync(  // todo: rerwrite with async iterators once avail
  readable: NodeJS.ReadableStream,
  callback: (line: string) => void,
  newline: string | RegExp = '\n'
) {
  return lineBulksAsync(readable, async lineBulk => {
    for await (let line of lineBulk) {
      await callback(line)
    }
  }, newline)
}

////////////////////////////////////////////////////////////////////////////////
export function linesAsyncStd(
  callback: (line: string) => void,
  newline: string | RegExp = '\n'
) {
  return linesAsync(process.stdin, callback, newline)
}
////////////////////////////////////////////////////////////////////////////////
export function chunksAsync(  // todo: rerwrite with async iterators once avail
  readable: NodeJS.ReadableStream,
  callback: (chunkBulk: Buffer[]) => void,
  splitter: Buffer
) {
  if (splitter.length !== 1) {
    throw new Error(`Only 1-byte splitters are currently supported`)
  }

  return new Promise<void>((resolve, reject) => {
    let leftover = Buffer.allocUnsafe(0)

    const consumer = async (chunk: Buffer) => {
      let ret = new Array<Buffer>()
      let start = 0
      let end = -1
      while ((end = chunk.indexOf(splitter, start)) >= 0) {
        if (leftover.length) {
          ret.push(Buffer.concat([leftover, chunk], leftover.length + end))
          // await callback(Buffer.concat([leftover, chunk], leftover.length + end))
          leftover = Buffer.allocUnsafe(0)
        } else {
          ret.push(chunk.slice(start, end))
          // await callback(chunk.slice(start, end))
        }
        start = end + splitter.length
      }

      if (start < chunk.length) {
        leftover = Buffer.allocUnsafe(chunk.length - start)
        chunk.copy(leftover, 0, start)
      }

      readable.pause()
      await callback(ret)
      readable.resume()
    }

    readable.on('data', consumer).on('end', async () => {
      await callback([leftover])
      resolve()
    })
  })
}

////////////////////////////////////////////////////////////////////////////////
export function linesBackpressed(
  source: NodeJS.ReadableStream,
  dest: NodeJS.WriteStream,
  listener: (line: string, write: (what: string | Buffer) => void) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const writer = (what: string | Buffer) => writeBackpressing(dest, source, what)
    createInterface(source)
      .on('line', line => listener(line, writer))
      .on('end', resolve)
      .on('error', reject)
  })
}

////////////////////////////////////////////////////////////////////////////////
export function linesBackpressedStd(
  listener: (line: string, write: (what: string | Buffer) => void) => void,
) {
  return linesBackpressed(process.stdin, process.stdout, listener)
}

////////////////////////////////////////////////////////////////////////////////
export function forEachLine(stream: NodeJS.ReadableStream, f: (line: string) => void) {
  return new Promise<void>((resolve, reject) => {
    createInterface(stream)
      .on('line', f)
      .on('close', resolve)
      .on('error', reject)
  })
}

////////////////////////////////////////////////////////////////////////////////
export async function allLinesFromStdin() {
  let ret = new Array<string>()
  await forEachLine(process.stdin, line => ret.push(line))
  return ret
}

////////////////////////////////////////////////////////////////////////////////
export function* linesStreamSync(filename: string) {
  let it = new lineIterator(filename)
  let bytes: Buffer
  while (bytes = it.next()) {
    yield bytes.toString('utf8')
  }
}

////////////////////////////////////////////////////////////////////////////////
export function* linesSync(filename: string) {  // todo: do not buffer file
  for (let line of readFileSync(filename, 'utf8').split('\n')) {
    yield line
  }
}

////////////////////////////////////////////////////////////////////////////////
export function readTsvMapSync(path: string, to?: Map<string, string>) {
  let ret = to || new Map<string, string>()
  for (let line of linesSync(path)) {
    let [key, val] = line.split('\t')
    ret.set(key, val)
  }
  return ret
}

////////////////////////////////////////////////////////////////////////////////
export function linesSyncArray(filePath: string) {
  return readFileSync(filePath, 'utf8').trim().split('\n')
}

////////////////////////////////////////////////////////////////////////////////
export function ignorePipeErrors() {
  process.stdout.on('error', err => {
    if (err.code === 'EPIPE') {
      //console.error(err.stack)
      process.exit(0)
    }
  })
}

////////////////////////////////////////////////////////////////////////////////
export function writeFileSyncMkdirp(filePath: string, value: string) {
  mkdirpSync(path.dirname(filePath))
  fs.writeFileSync(filePath, value)
  return filePath
}

////////////////////////////////////////////////////////////////////////////////
export function openSyncMkdirp(filePath: string, flags: string) {
  mkdirpSync(path.dirname(filePath))
  return fs.openSync(filePath, flags)
}

////////////////////////////////////////////////////////////////////////////////
export async function parseJsonFile(filePath: string) {
  let fileStr = await readFile(filePath, 'utf8')
  let ret = JSON.parse(fileStr)
  // console.error(ret)
  return ret
}

////////////////////////////////////////////////////////////////////////////////
export function parseJsonFileSync(filePath: string) {
  let fileStr = fs.readFileSync(filePath, 'utf8')
  let ret = JSON.parse(fileStr)
  return ret
}

////////////////////////////////////////////////////////////////////////////////
export function write2jsonFile(filePath: string, obj: any) {
  let json = JSON.stringify(obj)
  fs.writeFileSync(filePath, json)
}

//////////////////////////////////////////////////////////////////////////////
export async function joinToStream(
  strings: Iterable<string>,
  stream: NodeJS.WriteStream,
  joiner = '',
  trailing = false
) {
  let isFirst = true
  for await (let x of strings) {
    if (!isFirst) {
      await writePromiseDrain(stream, joiner)
    } else {
      isFirst = false
    }
    await writePromiseDrain(stream, x)
  }
  if (trailing) {
    await writePromiseDrain(stream, joiner)
  }
}

////////////////////////////////////////////////////////////////////////////////
export async function writeJoin(
  what: Iterable<string>,
  where: NodeJS.WriteStream,
  joiner: string,
  trailing = false
) {
  return writePromiseDrain(where, mu(what).join(joiner, trailing))
}
