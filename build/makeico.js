// Wrap the 256px PNG into a valid ICO container (PNG-in-ICO, Vista+).
// Usage: go run build/makeicon.go && node build/makeico.js
const fs = require('fs');
const png = fs.readFileSync(__dirname + '/icon256.png');
if (png.length < 256 || png.slice(1, 4).toString('ascii') !== 'PNG') {
  console.error('BAD_PNG');
  process.exit(1);
}
const hdr = Buffer.alloc(6);
hdr.writeUInt16LE(0, 0); // reserved
hdr.writeUInt16LE(1, 2); // type = icon
hdr.writeUInt16LE(1, 4); // count = 1
const entry = Buffer.alloc(16);
entry[0] = 0; // width: 256 -> 0
entry[1] = 0; // height: 256 -> 0
entry[2] = 0; // palette
entry[3] = 0; // reserved
entry.writeUInt16LE(1, 4);   // planes
entry.writeUInt16LE(32, 6);  // bpp
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12); // offset = 6 + 16
const out = Buffer.concat([hdr, entry, png]);
fs.writeFileSync(__dirname + '/icon.ico', out);
console.log('ICO_OK', out.length);
