import { r } from '../lang'


// todo: wait for unicode in node's V8
export const LETTER_UK = r`АаБбВвГгҐґДдЕеЄєЖжЗзИиІіЇїЙйКкЛлМмНнОоПпРрСсТтУуФфХхЦцЧчШшЩщЬьЮюЯя`
export const LETTER_UK_UPPERCASE = r`АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ`
export const WCHAR_UK = r`\-’${LETTER_UK}`
export const WCHAR_UK_UPPERCASE = r`\-’${LETTER_UK_UPPERCASE}`
export const FOREIGN_CHAR_RE = new RegExp(`[A-Za-zЫыЁёЪъЭэ]`)  // not negation
export const WORDCHAR_UK_RE = new RegExp(`^[${WCHAR_UK}]+$`)
export const WCHAR_NOT_UK_RE = new RegExp(`^[^${WCHAR_UK}]+$`)
export const WCHAR_OTHER = r`\u0301А-Яа-яóé`
export const WORDCHAR = r`\w${WCHAR_UK}${WCHAR_OTHER}`
export const WORDCHAR_RE = new RegExp(`^[${WORDCHAR}]+$`)


//(?:(?=\w)(?<!\w)|(?<=\w)(?!\w))

const diacritics = [
  ['і', '\u{308}', 'ї'],
  ['и', '\u{306}', 'й'],
  // ['', '', ''],
]
