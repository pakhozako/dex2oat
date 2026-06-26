const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { ensureDir, listFiles, slash } = require("./toolkit");

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff, 0);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function fixedDosTime() {
  return { time: 0, date: 33 };
}

async function createZipFromDirectory(sourceDir, zipPath, options = {}) {
  const base = path.resolve(sourceDir);
  const files = await listFiles(base, { skip: options.skip || [] });
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, date } = fixedDosTime();

  for (const file of files) {
    const relativeName = slash(path.relative(base, file));
    const name = Buffer.from(relativeName, "utf8");
    const content = await fs.readFile(file);
    const compressed = zlib.deflateRawSync(content, { level: 9 });
    const crc = crc32(content);

    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(8),
      u16(time),
      u16(date),
      u32(crc),
      u32(compressed.length),
      u32(content.length),
      u16(name.length),
      u16(0),
      name
    ]);
    localParts.push(localHeader, compressed);

    const centralHeader = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(8),
      u16(time),
      u16(date),
      u32(crc),
      u32(compressed.length),
      u32(content.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const local = Buffer.concat(localParts);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(centralOffset),
    u16(0)
  ]);

  await ensureDir(path.dirname(zipPath));
  await fs.writeFile(zipPath, Buffer.concat([local, central, end]));
  return {
    zipPath,
    fileCount: files.length,
    bytes: (await fs.stat(zipPath)).size
  };
}

module.exports = {
  createZipFromDirectory
};
