// Construction et signature du manifeste de mise à jour automatique.
// Le format du message signé doit rester identique à
// `UpdatePolicy.signedMessage` côté Swift.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export const UPDATE_SCHEMA = 1;

export function signedMessage(version, size, sha256) {
  return Buffer.from(`cinecrique-update-v${UPDATE_SCHEMA}\n${version}\n${size}\n${String(sha256).toLowerCase()}\n`, "utf8");
}

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function rawPublicKey(privateKeyPem) {
  const der = createPublicKey(createPrivateKey(privateKeyPem)).export({ format: "der", type: "spki" });
  return Buffer.from(der).subarray(-32).toString("base64");
}

export function changelogSection(changelog, version) {
  const lines = String(changelog || "").split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start < 0) return "";
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## ["));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim().slice(0, 20_000);
}

export function buildManifest({ version, build = "", dmg, url, releaseURL, notes = "", minimumSystemVersion = "13.0", privateKeyPem, publishedAt = new Date().toISOString() }) {
  if (!/^\d{1,4}(\.\d{1,4}){1,3}$/.test(version)) throw new Error(`version invalide : ${version}`);
  const size = dmg.length;
  const digest = sha256Hex(dmg);
  const signature = sign(null, signedMessage(version, size, digest), createPrivateKey(privateKeyPem)).toString("base64");
  return {
    schema: UPDATE_SCHEMA,
    version,
    build: String(build),
    publishedAt,
    minimumSystemVersion,
    notes,
    releaseURL,
    dmg: { url, size, sha256: digest },
    signature,
  };
}

export function verifyManifest(manifest, publicKeyBase64) {
  const raw = Buffer.from(publicKeyBase64, "base64");
  if (raw.length !== 32) return false;
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]);
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  return verify(
    null,
    signedMessage(manifest.version, manifest.dmg.size, manifest.dmg.sha256),
    key,
    Buffer.from(manifest.signature, "base64"),
  );
}
