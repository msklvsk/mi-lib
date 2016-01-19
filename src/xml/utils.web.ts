// import {$el} from './api/webapi_adapters';
import {walkUpUntil, nLevelsDeep} from './utils';
import {parseXml, serializeXml} from '../utils.web';

////////////////////////////////////////////////////////////////////////////////
export function replaceRangeWithStr(range: Range, rangeStr: string) {
  let holeStart = range.startContainer.previousSibling || range.startContainer.parentNode;
  let holeEnd = range.endContainer.nextSibling || range.endContainer.parentNode.nextSibling;
  //range.deleteContents();
  range.setStartBefore(holeStart);
  range.setEndAfter(holeEnd);
  insertRangeStr(range, rangeStr);
}

////////////////////////////////////////////////////////////////////////////////
export function insertRangeStr(hole: Range, rangeStr: string) {
  let rootClone = hole.startContainer.ownerDocument.documentElement.cloneNode(false);
  let rootName = rootClone.nodeName;
  let rootStr = serializeXml(rootClone).slice(0, -2) + '>';

  let fragment = parseXml(rootStr + rangeStr + `</${rootName}>`);  // contextual?
  
  let destDepth = -1;
  walkUpUntil(hole.startContainer, x => {
    ++destDepth
    return x.parentNode === hole.commonAncestorContainer
  });
  
  let source = nLevelsDeep(fragment.documentElement.firstChild, destDepth);
  
  mergeTrees(source, hole.startContainer, hole.endContainer)
}


////////////////////////////////////////////////////////////////////////////////
function mergeTrees(source: Node, dest: Node, destEnd: Node) {
  //(<HTMLElement>dest).innerHTML = '<mi:w_><w lemma="loh">oooo</w></mi:w_>';
  //console.log('mergetrees');
}