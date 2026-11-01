/**
 * Muuttujien näkyvyys vanhoissa laiteohjelmistoissa.
 *
 * Vanhemmat laiteohjelmistot (esim. Gen 2:n 1.3.2) käsittelevät let- ja const-muuttujia kuin
 * var-muuttujia: lohkon sisällä esitelty muuttuja ei ole lohkokohtainen, vaan ylikirjoittaa
 * samannimisen muuttujan funktiossa. Koontivaihe muuttaa siksi let- ja const-muuttujat
 * var-muotoon ennen pienennystä (shelly-builder.js).
 *
 * Testit varmistavat, että koodi toimii samoin molemmilla tavoilla:
 *  - lähdekoodissa lohkon muuttujalla ei ole samaa nimeä kuin ulommalla muuttujalla
 *  - silmukan sisällä luotu funktio ei käytä silmukan let-muuttujaa (var-muodossa kaikki
 *    kierrokset jakaisivat saman muuttujan)
 *  - koontiversioissa ei ole päällekkäisiä nimiä (pienennys voisi muuten tuottaa niitä)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('uglify-js');

const ROOT = path.join(__dirname, '..');

/** Lohkon let/const-muuttujat, joiden nimi on jo käytössä samassa funktiossa (tai sitä ulompana) */
function shadowed(code) {
  const ast = U.parse(code);
  ast.figure_out_scope();
  const hits = [];

  ast.walk(new U.TreeWalker(node => {
    if (!(node instanceof U.AST_SymbolLet || node instanceof U.AST_SymbolConst)) {
      return;
    }
    const def = node.definition();
    //Funktion tasolla esitelty muuttuja toimii samoin kuin var
    if (def.scope instanceof U.AST_Lambda || def.scope instanceof U.AST_Toplevel) {
      return;
    }
    for (let s = def.scope.parent_scope; s; s = s.parent_scope) {
      const other = s.variables.get(def.name);
      if (other && other !== def) {
        hits.push(`${def.name} rivillä ${node.start.line}`);
        break;
      }
      if (s instanceof U.AST_Lambda) {
        break;
      }
    }
  }));
  return hits;
}

/** Silmukan sisällä luodut funktiot, jotka käyttävät silmukan sisällä esiteltyä let/const-muuttujaa */
function loopClosures(code) {
  const ast = U.parse(code);
  ast.figure_out_scope();
  const hits = [];

  const walker = new U.TreeWalker(node => {
    if (!(node instanceof U.AST_Lambda)) {
      return;
    }
    //Lähin silmukka ennen ulompaa funktiota
    let loop = null;
    for (let i = walker.stack.length - 2; i >= 0; i--) {
      const p = walker.stack[i];
      if (p instanceof U.AST_Lambda) {
        break;
      }
      if (p instanceof U.AST_IterationStatement) {
        loop = p;
        break;
      }
    }
    if (!loop) {
      return;
    }
    node.walk(new U.TreeWalker(ref => {
      if (!(ref instanceof U.AST_SymbolRef) || !ref.definition()) {
        return;
      }
      const decl = ref.definition().orig[0];
      if ((decl instanceof U.AST_SymbolLet || decl instanceof U.AST_SymbolConst)
        && decl.start.pos >= loop.start.pos && decl.start.pos <= loop.end.endpos
        && !(decl.start.pos >= node.start.pos && decl.start.pos <= node.end.endpos)) {
        hits.push(`${ref.name} rivillä ${ref.start.line}`);
      }
    }));
  });
  ast.walk(walker);
  return hits;
}

const sources = ['src/shelly-porssisahko.js']
  .concat(fs.readdirSync(path.join(ROOT, 'src', 'after-build')).map(f => `src/after-build/${f}`));

const builds = fs.readdirSync(path.join(ROOT, 'dist')).filter(f => f.endsWith('.js')).map(f => `dist/${f}`);

describe('muuttujien näkyvyys vanhoissa laiteohjelmistoissa', () => {
  for (const file of sources) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');

    test(`${file}: lohkon muuttujalla ei ole samaa nimeä kuin ulommalla`, () => {
      assert.deepEqual(shadowed(code), []);
    });

    test(`${file}: silmukassa luotu funktio ei käytä silmukan let-muuttujaa`, () => {
      assert.deepEqual(loopClosures(code), []);
    });
  }

  for (const file of builds) {
    test(`${file}: ei päällekkäisiä nimiä`, () => {
      assert.deepEqual(shadowed(fs.readFileSync(path.join(ROOT, file), 'utf8')), []);
    });
  }

  test('pääskriptin koontiversiossa ei ole let- eikä const-muuttujia', () => {
    const code = fs.readFileSync(path.join(ROOT, 'dist', 'shelly-porssisahko.js'), 'utf8');
    const ast = U.parse(code);
    let count = 0;
    ast.walk(new U.TreeWalker(node => {
      if (node instanceof U.AST_Let || node instanceof U.AST_Const) {
        count++;
      }
    }));
    assert.equal(count, 0);
  });

  test('tarkistukset tunnistavat ongelmalliset kohdat', () => {
    assert.deepEqual(shadowed('function f(t) { if (t < 0) { let t = 1; } return t; }'), ['t rivillä 1']);
    assert.deepEqual(shadowed('function f(t) { if (t < 0) { let u = 1; } return t; }'), []);
    assert.deepEqual(loopClosures('function f(a) { for (let i = 0; i < 3; i++) { a.push(function () { return i; }); } }'), ['i rivillä 1']);
    assert.deepEqual(loopClosures('function f(a) { for (let i = 0; i < 3; i++) { a.push(function (x) { let y = x; return y; }); } }'), []);
  });
});
