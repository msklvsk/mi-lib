import {IDocument, INode, IElement} from './interface';
import * as libxmljs from 'libxmljs';
import {lang, pretty} from '../utils';
import {wrappedOrNull, ithGenerated, countGenerated} from '../../lang'; 



////////////////////////////////////////////////////////////////////////////////
export class LibxmlDocument extends IDocument {
	constructor(private _underlying: libxmljs.XMLDocument) {
    super();
  }
	
	get documentElement() {
		return new LibxmlElement(this._underlying.root());
	}
	
	createElement(name: string) {
    let [localName, prefix] = name.split(':').reverse();
		let ret = new libxmljs.Element(this._underlying, localName);
    prefix && ret.namespace(this._getNsByPrefix(prefix));
    
    return new LibxmlElement(ret);
	}
	
	serialize() {
		return this._underlying.toString();
	}
  
  private _getNsByPrefix(prefix: string) {
    return this._underlying.root().namespaces().find(x => x.prefix() === prefix);
  }
}

////////////////////////////////////////////////////////////////////////////////
export class LibxmlNode extends INode {
	constructor(public underlying) {  // todo: protected
    super();
  }
	
	equals(other: LibxmlNode) {
		return other && this.underlying === other.underlying;
	}
	
	lang() {
		return lang(this);
	}
	
	isElement() {
		return this.underlying.type() === 'element';
	}
	
	isText() {
		return this.underlying.type() === 'text';
	}
	
	isRoot() {
		return this.underlying === this.underlying.doc().root();
	}
	
	get nodeName() {
		let type = this.underlying.type();
		if (type === 'element') {
			return this.underlying.name();
		}
		return '#' + this.underlying.type();
	}
	
	is(name: string) {
		return this.nodeName === name;
	}
	
	get textContent() {
		return this.underlying.text();
	}
	
	set textContent(val: string) {
		this.underlying.text(val);
	}
	
	get ownerDocument()  {
		return wrappedOrNull(LibxmlDocument, this.underlying.doc());
	}
	
	get firstChild() {
		return switchReturnNodeType(this.underlying.child(0));
	}
	
	get parentNode() {
		return wrappedOrNull(LibxmlElement, this.underlying.parent());
	}
	
	get nextSibling() {
		return switchReturnNodeType(this.underlying.nextSibling());
	}
	
	remove() {
		return wrappedOrNull(LibxmlNode, this.underlying.remove());
	}
	
	replace(replacement: LibxmlNode) {
		this.underlying.replace(replacement.underlying);
	}
	
	insertBefore(newNode: LibxmlNode) {
		this.underlying.addPrevSibling(newNode.underlying);
		return newNode;
	}
	
	insertAfter(newNode: LibxmlNode) {
		this.underlying.addNextSibling(newNode.underlying);
	}
}

////////////////////////////////////////////////////////////////////////////////
export class LibxmlElement extends LibxmlNode {
	constructor(underlying: libxmljs.Element) {
		super(underlying);
	}
	
	get localName() {
		return this.underlying.name();
	}
	
	get firstElementChild() {
		let firstChild = this.underlying.child(0);
		while (firstChild && firstChild.type() !== 'element') {
			firstChild = firstChild.nextSibling();
		}
				
		return wrappedOrNull(LibxmlElement, firstChild);
	}
	
	get lastChild() {
		let children = this.underlying.childNodes;
		return wrappedOrNull(LibxmlNode, children[children.length - 1]);
	}
	
	*childElements() {
		for (let child of this.underlying.childNodes()) {
			if (child.type() === 'element') {
				yield new LibxmlElement(child);
			}
		}
	}
	
	childElement(index: number) {
    return ithGenerated(this.childElements(), index) || null;
	}
  
  get childElementCount() {
    return countGenerated(this.childElements());
  }
	
	get nextElementSibling() {
		return wrappedOrNull(LibxmlElement, this.underlying.nextElement());
	}
	
	nameNs() {
		let ns = this.underlying.namespace();
		let uri = ns ? ns.href() : 'http://www.tei-c.org/ns/1.0';		// todo: how to handle default properly?
		
    return '{' + uri + '}' + this.underlying.name();
	}
	
	// isNs(otherName: string) {
	// 	return this.nameNs() === otherName;
	// }
	
	getAttribute(name: string) {
		let attr = this.underlying.attr(name);
		return attr === null ? null : attr.value();
	}
	
	setAttribute(name: string, value: any) {
		this.underlying.attr({[name]: value.toString()});
	}
  
  renameAttributeIfExists(nameOld: string, nameNew: string) {
    let attr = this.underlying.attr(nameOld);
    if (attr) {
      this.underlying.attr({ [nameNew]: attr.value() });
      attr.remove();
    }
  }
	
	removeAttribute(name: string) {
    let attr = this.underlying.attr(name);
    attr && attr.remove();
	}
	
	appendChild(child: LibxmlNode) {
		this.underlying.addChild(child.underlying);
		return child;
	}
  
  clone() {
    return new LibxmlElement(this.underlying.clone()); 
  }
  
  xpath(query: string, nsMap?) {
    let result = this.underlying.find(query, nsMap);
    
    return (result || [])
      .map(x => x.type() === 'element' ? new LibxmlElement(x) : new LibxmlNode(x));
  }
  
  *xpathIt(query: string, nsMap?) {
    yield* this.xpath(query, nsMap);
  }
}





////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
function switchReturnNodeType(node) {
	return wrappedOrNull(node && node.type() === 'element' ? LibxmlElement : LibxmlNode, node);
}