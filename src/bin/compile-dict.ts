// todo: everything
import {readFileSync, writeFileSync} from 'fs';
import {collectForof} from '../lang';
import {lexemes, compileDict, CompiledDict} from '../nlp/morph_analyzer/dict_utils';
import {writeCompiledDict} from '../nlp/morph_analyzer/utils.node';
import {join} from 'path';
import {createMorphAnalyserSync} from '../nlp/morph_analyzer/factories.node';

var mkdirp = require('mkdirp');

let args = require('minimist')(process.argv.slice(2));
let input = args.i || args.input || join(__dirname, '../../../dict_uk/out/dict_corp_viz-mte.txt');
let name = args.name || 'rysin-mte';
let destDir = join(args.d || args.dest || join(__dirname, '../../data/dict'), name);


let lines = readFileSync(input, 'utf8').replace('\'', '’').split('\n');
let lexemes_ = collectForof(lexemes(lines));
let compiledDict = compileDict(<[string, string][][]>lexemes_);

mkdirp.sync(destDir);
writeCompiledDict(destDir, compiledDict);

console.log('done');