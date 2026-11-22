import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";

import { buildManifest, changelogSection, rawPublicKey, signedMessage, verifyManifest } from "../../scripts/update_manifest.mjs";

test("signs a release manifest that the embedded public key verifies", () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ format: "pem", type: "pkcs8" });
  const dmg = Buffer.from("faux contenu de DMG");
  const manifest = buildManifest({ version: "1.2.0", build: "3", dmg, url: "https://github.com/o/r/releases/download/1.2.0/C.dmg", releaseURL: "https://github.com/o/r/releases/tag/1.2.0", privateKeyPem: pem });
  const publicKey = rawPublicKey(pem);
  assert.equal(Buffer.from(publicKey, "base64").length, 32);
  assert.equal(manifest.dmg.size, dmg.length);
  assert.equal(Buffer.from(manifest.signature, "base64").length, 64);
  assert.equal(verifyManifest(manifest, publicKey), true);
  assert.equal(verifyManifest({ ...manifest, version: "9.9.9" }, publicKey), false);
  assert.equal(verifyManifest({ ...manifest, dmg: { ...manifest.dmg, sha256: "0".repeat(64) } }, publicKey), false);
  assert.throws(() => buildManifest({ version: "latest", dmg, url: "", privateKeyPem: pem }));
});

test("keeps the signed message format shared with the Swift updater", () => {
  assert.equal(signedMessage("1.2.0", 42, "ABCDEF").toString(), "cinecrique-update-v1\n1.2.0\n42\nabcdef\n");
});

test("extracts release notes from the changelog", () => {
  const changelog = "# Journal\n\n## [1.2.0] — 2026-11-22\n\n### Ajouté\n- Accueil\n\n## [1.1.0] — 2026-09-14\n- Studio";
  assert.equal(changelogSection(changelog, "1.2.0"), "### Ajouté\n- Accueil");
  assert.equal(changelogSection(changelog, "3.0.0"), "");
});
