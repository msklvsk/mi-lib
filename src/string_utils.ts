////////////////////////////////////////////////////////////////////////////////
export function titlecase(str: string, splitter = /[\s\-]\S/g) {
  let chars = [...str]
  if (chars.length) {
    chars[0] = chars[0].toUpperCase()
  }
  regexMatchIndexes(str, splitter).forEach(i => chars[i + 1] = chars[i + 1].toUpperCase())
  return chars.join('')
}

////////////////////////////////////////////////////////////////////////////////
export function regexMatchIndexes(str: string, regex: RegExp) {
  let ret = new Array<number>()
  let match: RegExpExecArray
  while (match = regex.exec(str)) {
    ret.push(match.index)
  }
  return ret
}

////////////////////////////////////////////////////////////////////////////////
/** replaceCaseAware('ГагаГа', /г/ig, 'ґ') === 'ҐаґаҐа' */
export function replaceCaseAware(str: string, substr: string | RegExp, newSubStr: string) {
  return str.replace(substr as any, (match) => {  // todo
    if (match.length !== newSubStr.length) {
      throw new Error(`Replace string length mismatch: ${match} ~ ${newSubStr}`)
    }
    let mask = uppercaseMask(match)
    return applyUppercaseMask(newSubStr, mask)
  })
}

////////////////////////////////////////////////////////////////////////////////
export function uppercaseMask(str: string) {
  let uppercase = str.toUpperCase()
  return [...uppercase].map((x, i) => x === str.charAt(i))
}

////////////////////////////////////////////////////////////////////////////////
export function applyUppercaseMask(str: string, mask: boolean[]) {
  return [...str].map((x, i) => mask[i] ? x.toUpperCase() : x.toLowerCase()).join('')
}

////////////////////////////////////////////////////////////////////////////////
export function startsWithCapital(str: string) {
  return str && str.charAt(0).toLowerCase() !== str.charAt(0)
}
