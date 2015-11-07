import {NS, nameNs, traverseDepth, traverseDocumentOrder, lang2, replace, isElement, isRoot, isText,
  remove, insertBefore, insertAfter} from '../xml/utils'
import {W, W_, PC, SE} from './common_tags' 
import {r} from '../lang';
import {Tagger} from '../tagger'


export const WCHAR = r`\-\w’АаБбВвГгҐґДдЕеЄєЖжЗзИиІіЇїЙйКкЛлМмНнОоПпРрСсТтУуФфХхЦцЧчШшЩщьЮюЯя`;
export const WCHAR_RE = new RegExp(`^[${WCHAR}]+$`);

//export const NOSPACE_ABLE_ELEMS
export const ELEMS_BREAKING_SENTENCE_NS = new Set([
  nameNs(NS.tei, 'p'),
  nameNs(NS.tei, 'body'),
  nameNs(NS.tei, 'text')
]);
const ELEMS_BREAKING_SENTENCE = new Set([
  'p', 'text'
]);

const PUNC_REGS = [
  r`„`,
  r`“`,
  r`«`,
  r`»`,
  r`\(`,
  r`\)`,
  r`\.`,
  r`\.{4,}`,
  r`…`,
  r`:`,
  r`;`,
  r`,`,
  r`[!?]+`,
  r`!\.{2,}`,
  r`\?\.{2,}`,
  r`—`,
];
const ANY_PUNC = PUNC_REGS.join('|');
const ANY_PUNC_OR_DASH_RE = new RegExp(`^${ANY_PUNC}|-$`);

let PUNC_SPACING = {
  ',': [false, true],
  '.': [false, true],
  ':': [false, true],
  ';': [false, true],
  '-': [false, false],    // dash
  '–': [false, false],    // n-dash
  '—': [true, true],  // m-dash
  '(': [true, false],
  ')': [false, true],
  '„': [true, false],
  '“': [false, false],    // what about eng?
  '«': [true, false],
  '»': [false, true],
  '!': [false, true],
  '?': [false, true],
  '…': [false, true],
};

const WORD_TAGS = new Set(['w', 'mi:w_', 'num']);
const WORD_TAGS_NS = new Set([W, W_]);


////////////////////////////////////////////////////////////////////////////////
export function haveSpaceBetween(tagA: string, textA: string,
                                 tagB: string, textB: string) {
  if (!tagA || !tagB) {
    return null;
  }
  let spaceA = !!PUNC_SPACING[textA] && PUNC_SPACING[textA][1];
  let spaceB = !!PUNC_SPACING[textB] && PUNC_SPACING[textB][0];
  let isWordA = WORD_TAGS_NS.has(tagA);
  let isWordB = WORD_TAGS_NS.has(tagB);

  if (isWordA && isWordB) {
    return true;
  }

  if (isWordA && tagB === PC) {
    return spaceB;
  }
  if (isWordB && tagA === PC) {
    return spaceA;
  }

  if (tagA === tagB && tagB === PC) {
    return spaceA && spaceB;
  }

  if (tagB === PC) {
    return spaceB;
  }

  if (tagA === SE) {
    return true;
  }

  return null;
}
////////////////////////////////////////////////////////////////////////////////
// todo: merge, rename
// export function haveSpaceBetween(a: HTMLElement, b: HTMLElement): boolean {
//   return isSpaceBetweenTokens(a.tagName, a.textContent, b.tagName, b.textContent);
// }

////////////////////////////////////////////////////////////////////////////////
export function haveSpaceBetween2(a: HTMLElement, b: HTMLElement): boolean {
  if (!a || !b) {
    return false;
  }
  let tagA = a.tagName;
  let tagB = b.tagName;
  let spaceA = !!PUNC_SPACING[a.innerHTML] && PUNC_SPACING[a.innerHTML][1];
  let spaceB = !!PUNC_SPACING[b.innerHTML] && PUNC_SPACING[b.innerHTML][0];
  let isWordA = WORD_TAGS.has(tagA);
  let isWordB = WORD_TAGS.has(tagB);

  if (isWordA && isWordB) {
    return true;
  }

  if (isWordA && tagB === 'pc') {
    return spaceB;
  }
  if (isWordB && tagA === 'pc') {
    return spaceA;
  }

  if (tagA === tagB && tagB === 'pc') {
    return spaceA && spaceB;
  }

  if (tagB === 'pc') {
    return spaceB;
  }

  if (tagA === 'mi:se') {
    return true;
  }

  return false;
}

////////////////////////////////////////////////////////////////////////////////
export function tokenizeUk(val: string, tagger: Tagger) {
  let toret: Array<string> = [];
  let splitRegex = new RegExp(`(${ANY_PUNC}|[^${WCHAR}])`);

  for (let tok0 of val.trim().split(splitRegex)) {
    for (let tok1 of tok0.split(/\s+/)) {
      if (tok1) {
        if (tok1.includes('-')) {
          if (!(tagger.knows(tok1))) {
            toret.push(...tok1.split(/(-)/).filter(x => !!x));
            continue;
          }
        }
        toret.push(tok1);
      }
    }
  }

  return toret;
}

////////////////////////////////////////////////////////////////////////////////
const TOSKIP = new Set(['w', 'mi:w_', 'pc', 'abbr', 'mi:se']);
////////////////////////////////////////////////////////////////////////////////
export function tokenizeTeiDom(root: Node, tagger: Tagger) {
  traverseDepth(root, (node: Node) => {
    if (isElement(node) && TOSKIP.has((<Element>node).tagName)) {
      return 'skip';
    }
    if (isText(node) && lang2(node) === 'uk') {
      for (let tok of tokenizeUk(node.nodeValue, tagger)) {
        insertBefore(nodeFromToken(tok, root.ownerDocument), node);
      }
      remove(node);
    }
  });
  
  return root;
}

////////////////////////////////////////////////////////////////////////////////
export function nodeFromToken(token: string, document: Document) {
  let toret;
  if (/^\d+$/.test(token)) {
    toret = document.createElement('num');
    toret.textContent = token;
  }
  else if (ANY_PUNC_OR_DASH_RE.test(token)) {
    toret = document.createElement('pc');
    toret.textContent = token;
  }
  else if (WCHAR_RE.test(token)) {
    toret = document.createElement('w');
    toret.textContent = token;
  }
  else {
    console.error(`DIE, "${token}"`);
    throw 'kuku' + token.length;
  }
  
  return toret;
}

//------------------------------------------------------------------------------
function tagWord(el: Element, tags) {
  let word = el.textContent;
  if (!tags.length) {
    el.setAttribute('lemma', word);
    el.setAttribute('ana', 'X');
  }
  else if (tags.length === 1) {
    let [lemma, tag] = tags[0];
    el.setAttribute('lemma', lemma);
    el.setAttribute('ana', tag);
  }
  else {
    let w_ = el.ownerDocument.createElement('mi:w_');
    for (let variant of tags) {
      let w = el.ownerDocument.createElement('w');
      w.textContent = word;
      let [lemma, tag] = variant;
      w.setAttribute('lemma', lemma);
      w.setAttribute('ana', tag);
      w_.appendChild(w);
    }
    replace(el, w_);    
  }
}
////////////////////////////////////////////////////////////////////////////////
export function tagTokenizedDom(root: Node, tagger: Tagger) {
  traverseDepth(root, (node: Node) => {
    if (isElement(node)) {
      let el = <Element>node;
      if (el.tagName === 'mi:w_') {
        return 'skip';
      }
      if (el.tagName === 'w') {
        tagWord(el, tagger.tag(el.textContent));
      }
    }
  });
  
  return root;
}

////////////////////////////////////////////////////////////////////////////////
export function insertSentenceEnd(where: HTMLElement) {
  traverseDocumentOrder(where, (node): any => {
    if (isElement(node)) {
      if (ELEMS_BREAKING_SENTENCE.has(node.tagName)) {
        
      }
      else if (/*node.nextElementSibling && */haveSpaceBetween2(node, node.nextElementSibling)) {
        where = node;
        return false;
      }
      if (node.tagName === 'mi:w_') {
        return 'skip';
      }
    }
  }, node => {
    if (isElement(node) && ELEMS_BREAKING_SENTENCE.has(node.tagName)) {
      where = node.lastChild;
      return false; 
    }
  });
  
  if (where.tagName !== 'mi:se') {
    let se = where.ownerDocument.createElement('mi:se');
    insertAfter(se, where);
  }
}