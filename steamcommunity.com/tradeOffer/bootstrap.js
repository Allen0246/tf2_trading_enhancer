/**
 * Matches the current page against the scripts registered by files in pages/ and runs
 * the matching one. Must load after shared.js and every file in pages/.
 *
 * manifest.json's MAIN-world content_scripts entry for this whole bundle
 * (shared.js + pages/* + this file) matches broadly - every *.backpack.tf/*
 * and steamcommunity.com/* page, not just the ones an individual pages/*.js
 * file actually handles - and relies entirely on the regex matching done
 * here (each page file's own `includes` patterns) to filter that down to the
 * one relevant page script per URL. That's a deliberate tradeoff, not an
 * oversight: MV3 content_scripts entries are static (no way to compute a
 * match pattern per pages/*.js file at build time, since there's no build
 * step at all - see the repo's own lack of a bundler), so one broad entry
 * plus this file's own client-side routing is simpler than one manifest
 * entry per page file, at the cost of every page file's script actually
 * loading (just not matching/running) on every page the bundle matches.
 */
(function () {
'use strict';

// window.__tf2te__ is built in shared.js (see the comment there for why it
// uses this dunder-prefixed name rather than a plainer global).
const { DEPS, scripts } = window.__tf2te__;

// Exactly one registered page script is expected to match any given URL -
// .find() only runs the first match, so if that invariant is ever broken by
// a future page registration, the rest would silently be ignored.
const matched = scripts.find(({ includes }) => {
    return includes.some((pattern) => Boolean(window.location.href.match(pattern)));
});

if (matched) {
    if (matched.styles) {
        const style = document.createElement('style');
        style.textContent = matched.styles;
        document.head.appendChild(style);
    }

    if (matched.fn) {
        matched.fn(DEPS);
    }
}

}());
