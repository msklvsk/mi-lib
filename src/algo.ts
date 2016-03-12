////////////////////////////////////////////////////////////////////////////////
export function numericCompare(a: number, b: number) {
  return a - b;
}

////////////////////////////////////////////////////////////////////////////////
export function uniqValuedMap2array(map) {
  return Object.keys(map).sort((a, b) => {
    return map[a] - map[b];
  })
}

////////////////////////////////////////////////////////////////////////////////
export function* findIndexwiseDiff(input: Array<any>) {
  let maxLen = Math.max(...input.map(x => x.length));
  let curDiffLen = 0;
  for (let j = 0; j < maxLen; ++j) {
    let cur = input[0][j];
    for (let i = 1; i < input.length; ++i) {
      if (input[i][j] !== cur) {
        ++curDiffLen;
        break;
      }
      if (curDiffLen) {
        yield [j - curDiffLen, curDiffLen];
        curDiffLen = 0;
      }
    }
  }
  if (curDiffLen) {
    yield [maxLen - curDiffLen, curDiffLen];
  }
}

////////////////////////////////////////////////////////////////////////////////
export function longestCommonSubstring(strings: Array<string>) {  // naive
  let ret = '';
  if (strings.length) {
    for (let i = 0; i < strings[0].length; ++i) {
      for (let j = 0; j < strings[0].length - i + 1; ++j) {
        let candidate = strings[0].substring(i, i + j);
        if (j > ret.length && strings.every(x => x.indexOf(candidate) >= 0)) {
          ret = candidate;
        }
      }
    }
  }

  return ret;
}

////////////////////////////////////////////////////////////////////////////////
export function indexTableByColumns(table: Object[], colNames: string[]) {
  let ret = new Map();

  for (let row of table) {
    if (colNames[colNames.length - 1] in row) {
      let cur = ret;
      for (let i = 0, bound = colNames.length - 1; i < bound; ++i) {
        let col = colNames[i];
        let cell = row[col];
        cur = cur.get(cell) || cur.set(cell, new Map()).get(cell);
      }
      cur.set(row[colNames[colNames.length - 1]], row);
    }
  }

  return ret;
}