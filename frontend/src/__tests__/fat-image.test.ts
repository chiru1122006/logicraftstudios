/**
 * fat-image.test.ts — verifies buildFat16Image() produces a structurally valid,
 * mountable FAT16 image. A compact FAT16 reader (below) parses the image back
 * and we assert a full round-trip (names + bytes), plus BPB/structure checks.
 */
import { describe, it, expect } from 'vitest';
import { buildFat16Image, normalizeSdPath, readFat16Image, type SdFile } from '../utils/fatImage';
import { buildProjectSdImage, bytesToB64, decodeSdFiles } from '../utils/sdCardFiles';

// ── Minimal FAT16 reader (test-only) — parses root dir + FAT chains ──────────
function readFat16(img: Uint8Array): { name: string; data: Uint8Array }[] {
  const u16 = (o: number) => img[o] | (img[o + 1] << 8);
  const u32 = (o: number) => img[o] | (img[o + 1] << 8) | (img[o + 2] << 16) | img[o + 3] * 0x1000000;
  const bps = u16(11);
  const spc = img[13];
  const reserved = u16(14);
  const numFats = img[16];
  const rootEntries = u16(17);
  const fatSz = u16(22);
  const fatStart = reserved * bps;
  const rootSectors = Math.ceil((rootEntries * 32) / bps);
  const rootStart = (reserved + numFats * fatSz) * bps;
  const dataStart = (reserved + numFats * fatSz + rootSectors) * bps;
  const clusterBytes = spc * bps;
  const fatEntry = (cl: number) => u16(fatStart + cl * 2);

  const out: { name: string; data: Uint8Array }[] = [];
  const lfnSlots = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30];
  let lfn = '';

  for (let i = 0; i < rootEntries; i++) {
    const e = rootStart + i * 32;
    const first = img[e];
    if (first === 0x00) break; // end of directory
    if (first === 0xe5) { lfn = ''; continue; } // deleted
    const attr = img[e + 11];
    if (attr === 0x0f) {
      let part = '';
      for (const s of lfnSlots) {
        const c = img[e + s] | (img[e + s + 1] << 8);
        if (c === 0x0000 || c === 0xffff) break;
        part += String.fromCharCode(c);
      }
      lfn = part + lfn; // entries are physically reverse-ordered
      continue;
    }
    if (attr & 0x08) { lfn = ''; continue; } // volume label

    let name: string;
    if (lfn) {
      name = lfn;
      lfn = '';
    } else {
      const base = String.fromCharCode(...img.slice(e, e + 8)).replace(/ +$/, '');
      const ext = String.fromCharCode(...img.slice(e + 8, e + 11)).replace(/ +$/, '');
      name = ext ? `${base}.${ext}` : base;
    }
    const startCluster = u16(e + 26);
    const size = u32(e + 28);
    const data = new Uint8Array(size);
    let cl = startCluster;
    let off = 0;
    while (cl >= 2 && cl < 0xfff8 && off < size) {
      const at = dataStart + (cl - 2) * clusterBytes;
      const n = Math.min(clusterBytes, size - off);
      data.set(img.slice(at, at + n), off);
      off += n;
      cl = fatEntry(cl);
    }
    out.push({ name, data });
  }
  return out;
}

const bytes = (s: string) => new TextEncoder().encode(s);

describe('buildFat16Image', () => {
  it('produces a valid FAT16 boot sector', () => {
    const img = buildFat16Image([]);
    expect(img[510]).toBe(0x55);
    expect(img[511]).toBe(0xaa);
    expect(img[11] | (img[12] << 8)).toBe(512); // bytes/sector
    expect(String.fromCharCode(...img.slice(54, 62))).toBe('FAT16   ');
    // cluster count must be in the FAT16 range (otherwise it'd be FAT12/FAT32)
    const fatSz = img[22] | (img[23] << 8);
    const totalSectors = img[19] | (img[20] << 8);
    const clusters = totalSectors - 1 - 2 * fatSz - 32;
    expect(clusters).toBeGreaterThanOrEqual(4085);
    expect(clusters).toBeLessThanOrEqual(65524);
  });

  it('round-trips short (8.3) files: names case-insensitive, bytes exact', () => {
    const files: SdFile[] = [
      { name: 'DATA.BIN', data: Uint8Array.from([1, 2, 3, 4, 250, 255]) },
      { name: 'HELLO.TXT', data: bytes('hello sd world') },
    ];
    const got = readFat16(buildFat16Image(files));
    expect(got.length).toBe(2);
    for (const f of files) {
      const r = got.find((g) => g.name.toLowerCase() === f.name.toLowerCase());
      expect(r, `missing ${f.name}`).toBeTruthy();
      expect(Array.from(r!.data)).toEqual(Array.from(f.data));
    }
  });

  it('preserves long file names exactly via LFN', () => {
    const files: SdFile[] = [{ name: 'my-long-config.json', data: bytes('{"ok":true}') }];
    const got = readFat16(buildFat16Image(files));
    expect(got.length).toBe(1);
    expect(got[0].name).toBe('my-long-config.json');
    expect(new TextDecoder().decode(got[0].data)).toBe('{"ok":true}');
  });

  it('round-trips a multi-cluster (>512 byte) binary file', () => {
    const big = new Uint8Array(2000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 0xff;
    const got = readFat16(buildFat16Image([{ name: 'IMG.RAW', data: big }]));
    expect(got.length).toBe(1);
    expect(got[0].data.length).toBe(2000);
    expect(Array.from(got[0].data)).toEqual(Array.from(big));
  });

  it('handles several files together', () => {
    const files: SdFile[] = [
      { name: 'A.TXT', data: bytes('aaa') },
      { name: 'photo.bmp', data: new Uint8Array(1500).fill(0xab) },
      { name: 'B.DAT', data: Uint8Array.from([9, 8, 7]) },
    ];
    const got = readFat16(buildFat16Image(files));
    expect(got.length).toBe(3);
    // photo.bmp fits 8.3, so it's stored case-folded (PHOTO.BMP) — match loosely.
    const photo = got.find((g) => g.name.toLowerCase() === 'photo.bmp');
    expect(photo!.data.length).toBe(1500);
    expect(photo!.data.every((b) => b === 0xab)).toBe(true);
  });

  it('throws when files exceed the volume capacity', () => {
    const huge = new Uint8Array(2 * 1024 * 1024);
    expect(() => buildFat16Image([{ name: 'BIG.BIN', data: huge }], { volumeBytes: 1024 * 1024 })).toThrow();
  });
});

describe('buildProjectSdImage', () => {
  it('auto-copies workspace DATA files; source files stay off the card', () => {
    const ws = [
      { name: 'sketch.ino', content: 'void setup(){}' },
      { name: 'helper.h', content: '#define X 1' },
      { name: 'impl.cpp', content: 'int x;' },
      { name: 'script.py', content: 'print(1)' },
      { name: 'notes.txt', content: 'hello from the card' },
      { name: 'config.json', content: '{}' },
    ];
    const got = readFat16(buildProjectSdImage(ws));
    const names = got.map((g) => g.name.toLowerCase());
    const notes = got.find((g) => g.name.toLowerCase() === 'notes.txt');
    expect(notes).toBeTruthy();
    expect(new TextDecoder().decode(notes!.data)).toBe('hello from the card');
    expect(names).toContain('config.json');
    // Code lives in flash, not on the microSD.
    expect(names).not.toContain('sketch.ino');
    expect(names).not.toContain('helper.h');
    expect(names).not.toContain('impl.cpp');
    expect(names).not.toContain('script.py');
  });

  it('an explicit upload lands even with a source extension', () => {
    const uploaded = decodeSdFiles([
      { name: 'ref.py', contentB64: bytesToB64(new TextEncoder().encode('print(2)')) },
    ]);
    const got = readFat16(buildProjectSdImage([], uploaded));
    expect(got.some((g) => g.name.toLowerCase() === 'ref.py')).toBe(true);
  });

  it('uploaded (paid) files override same-named project files', () => {
    const ws = [{ name: 'data.bin', content: 'TEXT' }];
    const uploaded = [{ name: 'data.bin', data: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]) }];
    const got = readFat16(buildProjectSdImage(ws, uploaded));
    const f = got.find((g) => g.name.toLowerCase() === 'data.bin')!;
    expect(Array.from(f.data)).toEqual([0xde, 0xad, 0xbe, 0xef]); // binary, not "TEXT"
  });

  it('adds uploaded binary files alongside project data files', () => {
    const ws = [
      { name: 'main.ino', content: 'x' }, // source: stays off the card
      { name: 'readme.txt', content: 'data' },
    ];
    const uploaded = [{ name: 'logo.bmp', data: new Uint8Array(800).fill(0x42) }];
    const got = readFat16(buildProjectSdImage(ws, uploaded));
    expect(got.length).toBe(2); // readme.txt + logo.bmp, no main.ino
    const logo = got.find((g) => g.name.toLowerCase() === 'logo.bmp')!;
    expect(logo.data.length).toBe(800);
    expect(logo.data.every((b) => b === 0x42)).toBe(true);
  });
});

describe('sdCardFiles upload helpers', () => {
  it('bytesToB64 / decodeSdFiles round-trip (binary-safe)', () => {
    const data = Uint8Array.from([0, 1, 2, 254, 255, 128, 64, 0, 13, 10]);
    const decoded = decodeSdFiles([{ name: 'x.bin', contentB64: bytesToB64(data) }]);
    expect(decoded.length).toBe(1);
    expect(decoded[0].name).toBe('x.bin');
    expect(Array.from(decoded[0].data)).toEqual(Array.from(data));
  });

  it('decodeSdFiles ignores malformed entries', () => {
    expect(decodeSdFiles(undefined)).toEqual([]);
    expect(decodeSdFiles([{ name: 'a' }, { contentB64: 'AAA' }, 5, null]).length).toBe(0);
  });

  it('decoded uploaded binaries land on the card', () => {
    const data = new Uint8Array(700).fill(0x7e);
    const uploaded = decodeSdFiles([{ name: 'snd.wav', contentB64: bytesToB64(data) }]);
    const f = readFat16(buildProjectSdImage([], uploaded)).find(
      (g) => g.name.toLowerCase() === 'snd.wav',
    )!;
    expect(f.data.length).toBe(700);
    expect(f.data.every((b) => b === 0x7e)).toBe(true);
  });
});

describe('folders: a "/" in the name puts the file in that directory', () => {
  const enc = (t: string) => new TextEncoder().encode(t);

  it('lists nested paths back, bytes exact, any depth', () => {
    const img = buildFat16Image([
      { name: 'MUSIC/tracklist.txt', data: enc('Blue Monday\n') },
      { name: 'MUSIC/album one/song.wav', data: new Uint8Array([1, 2, 3, 4]) },
      { name: 'readme.txt', data: enc('root') },
      { name: 'a/b/c/d/deep.bin', data: new Uint8Array(700).fill(7) },
    ]);
    const got = readFat16Image(img);
    // Names that fit 8.3 come back upper-cased (no LFN is written for them,
    // same as the root has always behaved); long names come back exact.
    const byName = Object.fromEntries(got.map((f) => [f.name.toLowerCase(), f]));
    expect(Object.keys(byName).sort()).toEqual(
      ['music/album one/song.wav', 'music/tracklist.txt', 'a/b/c/d/deep.bin', 'readme.txt'].sort(),
    );
    expect(got.map((f) => f.name)).toContain('MUSIC/tracklist.txt');
    expect(new TextDecoder().decode(byName['music/tracklist.txt'].data)).toBe('Blue Monday\n');
    expect(Array.from(byName['music/album one/song.wav'].data)).toEqual([1, 2, 3, 4]);
    expect(byName['a/b/c/d/deep.bin'].size).toBe(700);
    expect(byName['a/b/c/d/deep.bin'].data.every((b) => b === 7)).toBe(true);
  });

  it('a subdirectory starts with "." and ".." pointing at itself and its parent', () => {
    const img = buildFat16Image([{ name: 'DIR/SUB/f.txt', data: enc('x') }]);
    const u16 = (o: number) => img[o] | (img[o + 1] << 8);
    const bps = u16(11);
    const reserved = u16(14);
    const numFats = img[16];
    const rootEntries = u16(17);
    const fatSz = u16(22);
    const rootStart = (reserved + numFats * fatSz) * bps;
    const dataStart = rootStart + Math.ceil((rootEntries * 32) / bps) * bps;
    const clusterAt = (cl: number) => dataStart + (cl - 2) * bps * img[13];

    // Root: the volume label first (fsck.fat wants one to match the boot
    // sector), then DIR, attr 0x10, some first cluster.
    expect(img[rootStart + 11]).toBe(0x08);
    const r1 = rootStart + 32;
    expect(String.fromCharCode(...img.subarray(r1, r1 + 11))).toBe('DIR        ');
    expect(img[r1 + 11]).toBe(0x10);
    const dirCl = u16(r1 + 26);
    expect(dirCl).toBeGreaterThanOrEqual(2);
    // DIR's listing: ".", ".." (parent = root = 0), then SUB.
    const d = clusterAt(dirCl);
    expect(String.fromCharCode(...img.subarray(d, d + 11))).toBe('.          ');
    expect(u16(d + 26)).toBe(dirCl);
    expect(String.fromCharCode(...img.subarray(d + 32, d + 43))).toBe('..         ');
    expect(u16(d + 32 + 26)).toBe(0);
    expect(String.fromCharCode(...img.subarray(d + 64, d + 75))).toBe('SUB        ');
    const subCl = u16(d + 64 + 26);
    // SUB's ".." points back at DIR.
    const sd = clusterAt(subCl);
    expect(u16(sd + 32 + 26)).toBe(dirCl);
  });

  it('a folder with more entries than one cluster holds spans a chain', () => {
    // 1 sector per cluster = 16 entries; "." + ".." + 30 files needs 2+.
    const files: SdFile[] = [];
    for (let i = 0; i < 30; i++) files.push({ name: `LOGS/L${i}.TXT`, data: enc(`log ${i}`) });
    const got = readFat16Image(buildFat16Image(files));
    expect(got.map((f) => f.name).sort()).toEqual(files.map((f) => f.name).sort());
    expect(new TextDecoder().decode(got.find((f) => f.name === 'LOGS/L29.TXT')!.data)).toBe('log 29');
  });

  it('long names work inside folders too', () => {
    const got = readFat16Image(
      buildFat16Image([{ name: 'My Photos/holiday picture 2026.jpeg', data: enc('jpg') }]),
    );
    expect(got.map((f) => f.name)).toEqual(['My Photos/holiday picture 2026.jpeg']);
  });

  it('folder names are case-insensitive, like FAT: one folder, both files', () => {
    const got = readFat16Image(
      buildFat16Image([
        { name: 'Music/a.txt', data: enc('a') },
        { name: 'MUSIC/b.txt', data: enc('b') },
      ]),
    );
    expect(got.map((f) => f.name.toLowerCase()).sort()).toEqual(['music/a.txt', 'music/b.txt']);
  });

  it('normalizeSdPath: slashes tidy, "." and ".." dropped, backslashes accepted', () => {
    expect(normalizeSdPath('/MUSIC//tracklist.txt/')).toBe('MUSIC/tracklist.txt');
    expect(normalizeSdPath('.\\data\\cfg.json')).toBe('data/cfg.json');
    expect(normalizeSdPath('a/../b.txt')).toBe('a/b.txt');
    expect(normalizeSdPath('///')).toBe('');
  });

  it('buildProjectSdImage: uploads and workspace files keep their paths, overrides by path', () => {
    const img = buildProjectSdImage(
      [{ name: 'data/config.json', content: '{"a":1}' }],
      decodeSdFiles([
        { name: '/MUSIC/tracklist.txt', contentB64: bytesToB64(enc('t')) },
        { name: 'DATA/config.json', contentB64: bytesToB64(enc('{"a":2}')) },
      ]),
    );
    const got = readFat16Image(img);
    const byName = Object.fromEntries(got.map((f) => [f.name, new TextDecoder().decode(f.data)]));
    expect(Object.keys(byName).sort()).toEqual(['DATA/config.json', 'MUSIC/tracklist.txt']);
    expect(byName['DATA/config.json']).toBe('{"a":2}'); // the upload wins
  });
});

describe('readFat16Image (the production reader feeding the SD panel)', () => {
  it('round-trips names and bytes through build -> read', () => {
    const jpeg = new Uint8Array(2289);
    jpeg[0] = 0xff; jpeg[1] = 0xd8;
    jpeg[2287] = 0xff; jpeg[2288] = 0xd9;
    const files: SdFile[] = [
      { name: 'photo0.jpg', data: jpeg },
      { name: 'a-much-longer-file-name.txt', data: new TextEncoder().encode('hola') },
    ];
    const got = readFat16Image(buildFat16Image(files));
    expect(got.map((f) => f.name.toLowerCase()).sort()).toEqual([
      'a-much-longer-file-name.txt',
      'photo0.jpg',
    ]);
    const photo = got.find((f) => f.name.toLowerCase() === 'photo0.jpg')!;
    expect(photo.size).toBe(2289);
    expect(photo.data[0]).toBe(0xff);
    expect(photo.data[1]).toBe(0xd8);
    expect(photo.data[2288]).toBe(0xd9);
  });

  it('returns [] for garbage instead of throwing', () => {
    expect(readFat16Image(new Uint8Array(0))).toEqual([]);
    expect(readFat16Image(new Uint8Array(4096).fill(0x5a))).toEqual([]);
  });
});
