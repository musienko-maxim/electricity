import { classifyEntry } from '../src/lib/pdf/classify';

const raw = 'Бази відпочинку, ГДУ Держрибохорони в Черкаській області. вул. Дахнівська 1 , 2/15 , 2/17, 3 , 5 , 5/1 , 5/2 , 5/3 , 5/4 , 6 , 7/5 , 9 ,10 , 10а , вул. Набережна, 10/10-А';
const items = classifyEntry(raw);
console.log(`Got ${items.length} items:`);
for (const it of items) console.log(`  [${it.kind}] ${it.displayName}`);

// Direct regex test
const STREET_PREFIX_LOOKAHEAD = /^(вул\.|пров\.|просп\.|пр-?т|пл\.|бул\.|прв\.|ул\.|прс\.|б-р\.)/iu;
const chunk = 'ГДУ Держрибохорони в Черкаській області. вул. Дахнівська 1 , 2/15';
const posV = chunk.indexOf('вул.');
console.log(`\nchunk: ${chunk}`);
console.log(`Position of 'вул.': ${posV}`);
console.log(`chunk[posV-1] = '${chunk[posV-1]}' (whitespace/period? ${/[\s.]/.test(chunk[posV-1])})`);
console.log(`chunk.slice(posV).slice(0,10) = '${chunk.slice(posV).slice(0,10)}'`);
console.log(`lookahead match? ${STREET_PREFIX_LOOKAHEAD.test(chunk.slice(posV))}`);
