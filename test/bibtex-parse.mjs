// Vendored BibTeX parser sanity. Run: node test/bibtex-parse.mjs
import { strict as assert } from 'node:assert';
import bibtexParse from '../src/bibtex-parse.js';

const sample = `@article{smith2020,
  author = {Smith, Jane and Doe, John},
  title  = {On Things},
  journal= {J. Things},
  year   = {2020}
}`;
const out = bibtexParse.toJSON(sample);
assert.ok(Array.isArray(out), 'toJSON returns an array');
assert.equal(out.length, 1, 'one entry');
assert.equal(out[0].citationKey, 'smith2020', 'citationKey parsed');
assert.equal(String(out[0].entryType).toLowerCase(), 'article', 'entryType');
const tags = {};
for (const k in out[0].entryTags) tags[k.toLowerCase()] = out[0].entryTags[k];
assert.equal(tags.year, '2020', 'year tag');
assert.ok(/Smith/.test(tags.author), 'author tag');
console.log('bibtex-parse: ok');
