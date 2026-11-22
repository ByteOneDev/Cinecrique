import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeOnlineOptions,
  normalizeOnlineURL,
  onlineDRMWarning,
  onlineProjectFields,
  onlineSourceLabel,
} from "../../source/web/online.js";

test("accepts public web pages, with or without a scheme", () => {
  assert.equal(normalizeOnlineURL(" https://www.youtube.com/watch?v=abc "), "https://www.youtube.com/watch?v=abc");
  assert.equal(normalizeOnlineURL("archive.org/details/film"), "https://archive.org/details/film");
  assert.equal(normalizeOnlineURL("http://senpai-stream.example/anime/1"), "http://senpai-stream.example/anime/1");
});

test("rejects local, private, credentialed and non-web addresses", () => {
  for (const value of ["", "file:///etc/passwd", "javascript:alert(1)", "ftp://a.b/c", "http://localhost/x", "http://192.168.1.4/v", "http://127.0.0.1/", "https://user:pw@site.com/v", "https://a b.com", "notaurl", `https://a.com/${"x".repeat(2_100)}`]) {
    assert.equal(normalizeOnlineURL(value), "", value);
  }
});

test("labels sources and warns about DRM services", () => {
  assert.equal(onlineSourceLabel("https://youtu.be/x"), "YouTube");
  assert.equal(onlineSourceLabel("https://archive.org/details/x"), "Internet Archive");
  assert.equal(onlineSourceLabel("https://video.obscur.net/v/1"), "video.obscur.net");
  assert.match(onlineDRMWarning("https://www.netflix.com/watch/1"), /DRM/);
  assert.equal(onlineDRMWarning("https://www.youtube.com/watch?v=1"), "");
});

test("normalizes options and builds project fields", () => {
  assert.deepEqual(normalizeOnlineOptions({ quality: "9999", cookiesBrowser: "netscape" }), { quality: "1080", cookiesBrowser: "", subtitles: true });
  assert.deepEqual(normalizeOnlineOptions({ quality: "best", cookiesBrowser: "firefox", subtitles: false }), { quality: "best", cookiesBrowser: "firefox", subtitles: false });
  const fields = onlineProjectFields({ title: "Conférence", extractor: "YouTube", uploadDate: "20210304", duration: 5_520, webpageURL: "https://www.youtube.com/watch?v=1", uploader: "Cinémathèque" });
  assert.equal(fields.title, "Conférence");
  assert.equal(fields.detail, "YouTube · 2021 · 1h32");
  assert.equal(fields.source.kind, "online");
  assert.equal(fields.source.url, "https://www.youtube.com/watch?v=1");
});
