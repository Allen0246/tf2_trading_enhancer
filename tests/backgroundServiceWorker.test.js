import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// On Chrome, background.js runs as a module service worker, which refuses
// import() (fails when called) and a top-level await anywhere in its
// modules (fails to start at all). Firefox runs it as a page, where both
// work, so only these checks catch a regression before a Chrome user does.
// Confirmed live: import() broke the trade offer check and sign-in.

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");

// The source with comments and string/template contents blanked out, so a
// word inside a comment or string can't count.
function codeOnly(source) {
  let out = "";
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      out += source.slice(i, end + 2).replace(/[^\n]/g, " ");
      i = end + 1;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === "\\" ? 2 : 1;
      out += c + " ".repeat(Math.max(0, j - i - 1)) + c;
      i = j;
    } else {
      out += c;
    }
  }
  return out;
}

function hasDynamicImport(source) {
  return /\bimport\s*\(/.test(codeOnly(source));
}

// Whether the `{` at index `i` opens a function body: after `=>`, or after a
// parameter list `(…)` that doesn't belong to if/for/while/switch/catch/with
// (a plain block, like `if (x) { await … }` at module level, is still top
// level).
function opensFunctionBody(code, i) {
  const before = code.slice(0, i).trimEnd();
  if (before.endsWith("=>")) return true;
  if (!before.endsWith(")")) return false;
  let depth = 0;
  let j = before.length - 1;
  for (; j >= 0; j--) {
    if (before[j] === ")") depth++;
    else if (before[j] === "(" && --depth === 0) break;
  }
  const word = /([\w$]+)\s*$/.exec(before.slice(0, j))?.[1];
  return !["if", "for", "while", "switch", "catch", "with"].includes(word);
}

// An `await` outside every function body.
function hasTopLevelAwait(source) {
  const code = codeOnly(source);
  const braces = []; // per open `{`: whether it's a function body
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "{") braces.push(opensFunctionBody(code, i));
    else if (code[i] === "}") braces.pop();
    else if (
      !braces.includes(true) &&
      /^await\b/.test(code.slice(i, i + 6)) &&
      !/[\w$.]/.test(code[i - 1] || "")
    ) {
      return true;
    }
  }
  return false;
}

// Every module background.js loads, directly or through other modules.
function moduleGraph(entry) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = read(file);
    for (const [, spec] of source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^"';]*?from\s+["'](\.[^"']+)["']/g)) {
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)));
    }
    for (const [, spec] of source.matchAll(/(?:^|\n)\s*import\s+["'](\.[^"']+)["']/g)) {
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)));
    }
  };
  visit(entry);
  return [...seen];
}

test("the manifest loads background.js as a module, on both browsers", () => {
  const { background } = JSON.parse(read("manifest.json"));
  assert.equal(background.service_worker, "background.js");
  assert.deepEqual(background.scripts, ["background.js"]);
  assert.equal(background.type, "module");
});

test("the detectors work: an await outside functions counts, even in a plain block; comments and strings don't", () => {
  assert.equal(hasTopLevelAwait("async function f() { await x(); }\n// await y\nconst s = 'await';"), false);
  assert.equal(hasTopLevelAwait("const a = await b();"), true);
  assert.equal(hasTopLevelAwait("if (on) {\n  await start();\n}"), true);
  assert.equal(hasTopLevelAwait("const f = async () => { if (x) { await y(); } };"), false);
  assert.equal(hasTopLevelAwait("class A { async m(x) { for (;;) { await z(); } } }"), false);
  assert.equal(hasDynamicImport("/* import('x') */ const s = \"import(\";"), false);
  assert.equal(hasDynamicImport("const m = await import(url);"), true);
});

const graph = moduleGraph("background.js");

// The modules every build's background loads; the checks below cover the
// whole graph, whatever else a build adds to it.
test("background.js loads its modules statically (the graph is followed)", () => {
  for (const file of ["background.js", "utils/notificationSound.js", "utils/retryAfter.js", "utils/steamTradeOffers.js"]) {
    assert.ok(graph.includes(file), file);
  }
});

test("nothing the background loads uses import() (Chrome's service worker refuses it)", () => {
  assert.deepEqual(graph.filter((file) => hasDynamicImport(read(file))), []);
});

test("nothing the background loads has a top-level await (Chrome's service worker wouldn't start)", () => {
  assert.deepEqual(graph.filter((file) => hasTopLevelAwait(read(file))), []);
});
