import { AbstractNode, AbstractElement } from 'xmlapi';

// todo: move out
export const NS = {
  xml: 'http://www.w3.org/XML/1998/namespace',
  xhtml: 'http://www.w3.org/1999/xhtml',
  tei: 'http://www.tei-c.org/ns/1.0',
  mi: 'http://mova.institute/ns/corpora/0.1',
};



////////////////////////////////////////////////////////////////////////////////
export function cantBeXml(str: string) {
  return !/^\s*\</.test(str);
}

////////////////////////////////////////////////////////////////////////////////
export function escape(val: string) {   // todo
  return val.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

////////////////////////////////////////////////////////////////////////////////
export function xmlNsResolver(prefix: string) {
  return NS[prefix] || null;
}

////////////////////////////////////////////////////////////////////////////////
export function nameNs(ns: string, name: string) {
  return `{${ns}}${name}`;
}

////////////////////////////////////////////////////////////////////////////////
export function namePrefixed(prefix: string, name: string) {
  return prefix ? `${prefix}:${name}` : name;
}

////////////////////////////////////////////////////////////////////////////////
export function removeXmlns(xmlstr: string) {
  return xmlstr.replace(/ xmlns(:\w+)?="[^"]+"/g, '');
}

////////////////////////////////////////////////////////////////////////////////
export function removeRoot(xmlstr: string) {
  return xmlstr.replace(/^\s*(<\?xml[^>]+\?>)?\s*<[^>]+>/, '').replace(/<\/[^>]+>\s*$/, '');
}

////////////////////////////////////////////////////////////////////////////////
export function encloseInRoot(xmlstr: string, rootName = 'root') {
  return `<${rootName}>${xmlstr}</${rootName}>`;
}

////////////////////////////////////////////////////////////////////////////////
export function encloseInRootNs(value: string, rootName = 'mi:fragment', ns = ['tei', 'mi']) {
  let ret = '<' + rootName;
  if (NS[ns[0]]) {
    ret += ' xmlns="' + NS[ns[0]] + '"';
  }
  for (let i = 1; i < ns.length; ++i) {
    ret += ' xmlns:' + ns[i] + '="' + NS[ns[i]] + '"';
  }
  ret += '>\n  ' + value + '\n</' + rootName + '>';

  return ret;
}

////////////////////////////////////////////////////////////////////////////////
export function encloseInRootNsIf(value: string, rootName = 'mi:fragment', ns = ['tei', 'mi']) {
  if (cantBeXml(value)) {
    value = encloseInRootNs(value, rootName, ns);
  }

  return value;
}


////////////////////////////////////////////////////////////////////////////////
export function tagStr(open: boolean, prefix: string, elem: string, attrs = new Map()) {
  if (!open) {
    return `</${namePrefixed(prefix, elem)}>`;
  }
  let ret = `<${namePrefixed(prefix, elem)}`;
  for (let [key, value] of attrs.entries()) {
    ret += ` ${key}="${value}"`;
  }
  ret += '>';

  return ret;
}

////////////////////////////////////////////////////////////////////////////////
export function libxmlSaxAttrs(attrs: Array<[string, string, string, string]>) {
  let ret = new Map();
  for (let [name, , , val] of attrs) {
    ret.set(name, val);
  }

  return ret;
}

////////////////////////////////////////////////////////////////////////////////
export function traverseDepthEl(node: AbstractNode, onEnter: (el: AbstractElement) => any, onLeave?: (el: AbstractElement) => any) {
  traverseDepth(node, callbackIfElement(onEnter), callbackIfElement(onLeave));
}

////////////////////////////////////////////////////////////////////////////////
export type TraverseDirective = 'skip' | 'stop' | void;
export interface ITraverseCallback {
  (el: AbstractNode): TraverseDirective;
}
export function traverseDepth(node: AbstractNode, onEnter: ITraverseCallback, onLeave?: ITraverseCallback) {
  let directive = onEnter(node);
  if (directive === 'stop') {
    return false;
  }
  if (directive !== 'skip' && node.isElement()) {
    for (let cur = node.asElement().firstChild(), next = cur && cur.nextSibling();
      cur;
      cur = next, next = next && next.nextSibling()) {

      if (traverseDepth(cur, onEnter, onLeave) === false) {
        return false;
      }
    }
  }

  if (onLeave) {
    onLeave(node);
  }
}

////////////////////////////////////////////////////////////////////////////////
export function traverseDocumentOrder(node: AbstractNode, onEnter: ITraverseCallback, onLeave?: ITraverseCallback) {
  let curNode = node;
  for (; curNode; curNode = curNode.nextSibling()) {
    if (traverseDepth(curNode, onEnter, onLeave) === false) {
      return false;
    }
  }
  for (curNode = node && node.parent(); curNode; curNode = curNode.parent()) {
    if (curNode.nextSibling()) {
      if (traverseDocumentOrder(curNode.nextSibling(), onEnter, onLeave) === false) {
        return false;
      }
      break;
    }
  }
}

////////////////////////////////////////////////////////////////////////////////
export function traverseDocumentOrderEl(node: AbstractNode, onEnter: (el: AbstractElement) => TraverseDirective, onLeave?: (el: AbstractElement) => TraverseDirective) {
  traverseDocumentOrder(node, callbackIfElement(onEnter), callbackIfElement(onLeave));
}

////////////////////////////////////////////////////////////////////////////////
export function nextElDocumentOrder(context: AbstractElement, elsOfInterest?: Set<string>) {
  let ret: AbstractElement = null;
  traverseDocumentOrder(context, callbackIfElement(el => {
    if (!context.isSame(el) && (!elsOfInterest || !elsOfInterest.size || elsOfInterest.has(el.name()))) {
      ret = el;
      return 'stop';
    }
  }));

  return ret;
}

////////////////////////////////////////////////////////////////////////////////
export function walkUpUntil(node: AbstractNode, predicate: (node: AbstractNode) => boolean) {
  while (node && predicate(node.parent())) {
    node = node.parent();
  }

  return node;
}

////////////////////////////////////////////////////////////////////////////////
export function nLevelsDeep(node, n: number) {
  while (node && n--) {
    node = node.firstChild;  // todo: element?
  }

  return node;
}

////////////////////////////////////////////////////////////////////////////////
function callbackIfElement(cb: (el: AbstractElement) => TraverseDirective) {
  return node => {
    if (cb && node.isElement()) {
      return cb(node);
    }
  };
}

////////////////////////////////////////////////////////////////////////////////
export function sortChildElements(el: AbstractElement, compare: (a: AbstractElement, b: AbstractElement) => number) {
  let childrenSorted = [...el.elementChildren()].sort(compare);
  for (let child of childrenSorted) {
    el.appendChild(child.remove());
  }
}
