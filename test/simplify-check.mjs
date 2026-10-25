// Closed loops must survive simplification (a loop that ends on its start used to collapse to a dot).
import { simplify, strokeLen } from '../js/geom.js';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };

const loop = [[420, 300, 10], [380, 180, 10], [300, 160, 10], [330, 260, 10], [420, 300, 10]];
ok(simplify(loop, 1.2).length === 5, 'a 5-point loop that ends on its start keeps its points');

const circle = Array.from({ length: 61 }, (_, i) => { const a = (i / 60) * Math.PI * 2; return [500 + Math.cos(a) * 200, 500 + Math.sin(a) * 200, 10]; });
const sc = simplify(circle, 1.2);
ok(strokeLen(sc) > 1200, `a closed circle keeps its length (${Math.round(strokeLen(sc))} of ${Math.round(strokeLen(circle))})`);

const straight = Array.from({ length: 20 }, (_, i) => [i * 10, 0, 10]);
ok(simplify(straight, 1.2).length === 2, 'a straight line still reduces to its two ends');

const nearly = [[0, 0, 10], [300, 0, 10], [300, 300, 10], [0, 300, 10], [1, 1, 10]];
ok(simplify(nearly, 1.2).length === 5, 'a square closed to within a unit keeps its corners');

process.exitCode = fails ? 1 : 0;
