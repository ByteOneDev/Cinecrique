import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [iconsetPath, outputPath] = process.argv.slice(2);

if (!iconsetPath || !outputPath) {
  throw new Error("Usage: node script/build_icns.mjs <iconset> <output.icns>");
}

const variants = [
  ["icp4", "icon_16x16.png"],
  ["ic11", "icon_16x16@2x.png"],
  ["icp5", "icon_32x32.png"],
  ["ic12", "icon_32x32@2x.png"],
  ["ic07", "icon_128x128.png"],
  ["ic13", "icon_128x128@2x.png"],
  ["ic08", "icon_256x256.png"],
  ["ic14", "icon_256x256@2x.png"],
  ["ic09", "icon_512x512.png"],
  ["ic10", "icon_512x512@2x.png"],
];

const chunks = variants.map(([type, filename]) => {
  const data = readFileSync(join(iconsetPath, filename));
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(data.length + header.length, 4);
  return Buffer.concat([header, data]);
});

const header = Buffer.alloc(8);
header.write("icns", 0, 4, "ascii");
header.writeUInt32BE(header.length + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
writeFileSync(outputPath, Buffer.concat([header, ...chunks]));
