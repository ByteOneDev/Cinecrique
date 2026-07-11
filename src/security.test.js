import assert from "node:assert/strict";
import test from "node:test";

import { safeExternalURL } from "./security.js";

test("allows ordinary HTTP and HTTPS links", () => {
  assert.equal(safeExternalURL("https://www.themoviedb.org/movie/1"), "https://www.themoviedb.org/movie/1");
  assert.equal(safeExternalURL("http://example.com/note"), "http://example.com/note");
});

test("rejects executable, local, credentialed, and malformed URLs", () => {
  assert.equal(safeExternalURL("javascript:alert(1)"), "");
  assert.equal(safeExternalURL("file:///etc/passwd"), "");
  assert.equal(safeExternalURL("https://user:secret@example.com/"), "");
  assert.equal(safeExternalURL("not a URL"), "");
});
