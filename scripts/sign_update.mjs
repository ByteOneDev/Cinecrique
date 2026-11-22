#!/usr/bin/env node
// Publication des mises à jour automatiques de Cinécrique.
//
//   node scripts/sign_update.mjs keygen
//     Crée la clé privée Ed25519 dans ~/.cinecrique/update-signing-key.pem
//     (jamais dans le dépôt) et affiche la clé publique à copier dans
//     resources/macos/Info.plist → CinecriqueUpdatePublicKey.
//
//   node scripts/sign_update.mjs sign [dist/Cinécrique-1.2.0.dmg]
//     Écrit dist/cinecrique-update.json et dist/Cinecrique-<version>.dmg,
//     les deux fichiers à joindre à la publication GitHub.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, changelogSection, rawPublicKey, verifyManifest } from "./update_manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = process.env.CINECRIQUE_RELEASE_REPOSITORY || "ByteOneDev/Cinecrique";
const defaultKey = process.env.CINECRIQUE_UPDATE_KEY || join(homedir(), ".cinecrique", "update-signing-key.pem");

function plistValue(key) {
  const plist = readFileSync(join(root, "resources/macos/Info.plist"), "utf8");
  const match = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  return match ? match[1].trim() : "";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [command, argument] = process.argv.slice(2);

if (command === "keygen") {
  if (existsSync(defaultKey)) fail(`Une clé existe déjà : ${defaultKey}\nSupprimez-la explicitement pour en créer une autre (les versions installées ne pourront plus se mettre à jour).`);
  mkdirSync(dirname(defaultKey), { recursive: true, mode: 0o700 });
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ format: "pem", type: "pkcs8" });
  writeFileSync(defaultKey, pem, { mode: 0o600, flag: "wx" });
  chmodSync(defaultKey, 0o600);
  console.log(`Clé privée : ${defaultKey} (à sauvegarder hors du dépôt)`);
  console.log(`Clé publique pour Info.plist → CinecriqueUpdatePublicKey :\n${rawPublicKey(pem)}`);
} else if (command === "sign") {
  const version = plistValue("CFBundleShortVersionString");
  const build = plistValue("CFBundleVersion");
  const publicKey = plistValue("CinecriqueUpdatePublicKey");
  if (!publicKey) fail("CinecriqueUpdatePublicKey est vide dans Info.plist : lancez d’abord `node scripts/sign_update.mjs keygen`.");
  if (!existsSync(defaultKey)) fail(`Clé privée introuvable : ${defaultKey}`);
  const pem = readFileSync(defaultKey, "utf8");
  if (rawPublicKey(pem) !== publicKey) fail("La clé privée ne correspond pas à la clé publique déclarée dans Info.plist.");

  const source = resolve(argument || join(root, "dist", `Cinécrique-${version}.dmg`));
  if (!existsSync(source)) fail(`DMG introuvable : ${source}`);
  const assetName = `Cinecrique-${version}.dmg`;
  const asset = join(root, "dist", assetName);
  if (resolve(source) !== resolve(asset)) copyFileSync(source, asset);

  const notes = changelogSection(readFileSync(join(root, "CHANGELOG.md"), "utf8"), version);
  const manifest = buildManifest({
    version,
    build,
    dmg: readFileSync(asset),
    url: `https://github.com/${repository}/releases/download/${version}/${assetName}`,
    releaseURL: `https://github.com/${repository}/releases/tag/${version}`,
    notes,
    minimumSystemVersion: plistValue("LSMinimumSystemVersion") || "13.0",
    privateKeyPem: pem,
  });
  if (!verifyManifest(manifest, publicKey)) fail("La signature produite ne se vérifie pas.");
  const output = join(root, "dist", "cinecrique-update.json");
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(output);
  console.log(asset);
  console.log(`Publiez ces deux fichiers dans la version GitHub « ${version} » (${basename(asset)} et cinecrique-update.json).`);
} else {
  fail("usage : node scripts/sign_update.mjs keygen | sign [chemin-du-dmg]");
}
