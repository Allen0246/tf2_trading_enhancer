import { test } from "node:test";
import assert from "node:assert/strict";
import { stripHtmlTags } from "../utils/domText.js";

test("stripHtmlTags converts <br> to a newline", () => {
  assert.equal(stripHtmlTags("Level 17<br>Effect: Test"), "Level 17\nEffect: Test");
});

test("stripHtmlTags handles self-closing and spaced <br/> variants", () => {
  assert.equal(stripHtmlTags("a<br/>b<br />c<BR>d"), "a\nb\nc\nd");
});

test("stripHtmlTags drops every other tag with no replacement", () => {
  assert.equal(stripHtmlTags("<span class=\"x\">Effect</span>: Test"), "Effect: Test");
});

test("stripHtmlTags returns an empty string for null/undefined input", () => {
  assert.equal(stripHtmlTags(null), "");
  assert.equal(stripHtmlTags(undefined), "");
  assert.equal(stripHtmlTags(""), "");
});
