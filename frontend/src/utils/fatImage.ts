/**
 * fatImage.ts — build a FAT16 filesystem image from a set of files, in the
 * browser, with no dependencies.
 *
 * Used by the microSD card feature: the auto-copy of project files (free) and
 * the "SD Card" upload (paid) both produce a `{ name, data }[]` list that this
 * turns into a `Uint8Array` disk image. That image is handed to the
 * `microsd-card` simulation part via `element.sdImageData`, where the firmware
 * mounts it over SD-over-SPI and reads the files with `SD.open(...)`.
 *
 * Layout: "super-floppy" FAT16 (BPB at sector 0, no MBR) — SdFat / the Arduino
 * SD library mount this directly. 512-byte sectors, 1 sector per cluster, 2
 * FATs, 512 root entries. Short (8.3) names are emitted directly; names that do
 * not fit 8.3 get a generated 8.3 alias plus VFAT long-name (LFN) entries so the
 * real filename is preserved.
 *
 * Folders: a name with '/' in it ("MUSIC/tracklist.txt") lands in that
 * directory, created on the way, any depth. A subdirectory is a cluster chain
 * of entries starting with "." and "..", grown as its listing needs; the
 * root keeps its fixed 512 slots. A sketch then reads
 * `SD.open("/MUSIC/tracklist.txt")` exactly as on a card written by a PC.
 */

export interface SdFile {
  /** Path on the card, '/'-separated, no leading slash ("MUSIC/song.wav").
   *  Long names are preserved via LFN in every directory level. */
  name: string;
  data: Uint8Array;
}

/**
 * Normalise a card path: '\' becomes '/', empty / "." / ".." segments are
 * dropped, no leading or trailing slash. Returns '' for a name with nothing
 * left in it (the caller skips those).
 */
export function normalizeSdPath(raw: string): string {
  return raw
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => seg.trim())
    .filter((seg) => seg !== '' && seg !== '.' && seg !== '..')
    .join('/');
}

const SEC = 512;

function writeU16(buf: Uint8Array, off: number, v: number): void {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >> 8) & 0xff;
}
function writeU32(buf: Uint8Array, off: number, v: number): void {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >> 8) & 0xff;
  buf[off + 2] = (v >> 16) & 0xff;
  buf[off + 3] = (v >>> 24) & 0xff;
}
function writeAscii(buf: Uint8Array, off: number, s: string, len: number, pad = 0x20): void {
  for (let i = 0; i < len; i++) buf[off + i] = i < s.length ? s.charCodeAt(i) & 0xff : pad;
}

/** Is `name` a valid uppercase-able 8.3 short name (no LFN needed)? */
function fitsShort(name: string): boolean {
  const dot = name.lastIndexOf('.');
  const base = dot < 0 ? name : name.slice(0, dot);
  const ext = dot < 0 ? '' : name.slice(dot + 1);
  if (base.length === 0 || base.length > 8 || ext.length > 3) return false;
  return /^[A-Za-z0-9_~!#$%&'()@^{}-]+$/.test(base) && /^[A-Za-z0-9_~!#$%&'()@^{}-]*$/.test(ext);
}

/** Build the 11-byte padded 8.3 representation ("HELLO   TXT"). */
function pad83(base: string, ext: string): string {
  const b = (base.toUpperCase() + '        ').slice(0, 8);
  const e = (ext.toUpperCase() + '   ').slice(0, 3);
  return b + e;
}

function sanitize83(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9_~!#$%&'()@^{}-]/g, '_');
}

/** Generate a unique 11-char 8.3 name for `name`, tracking collisions. */
function shortNameFor(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const baseRaw = dot < 0 ? name : name.slice(0, dot);
  const extRaw = dot < 0 ? '' : name.slice(dot + 1);
  const ext = sanitize83(extRaw).slice(0, 3);

  if (fitsShort(name)) {
    const s = pad83(sanitize83(baseRaw), ext);
    if (!used.has(s)) {
      used.add(s);
      return s;
    }
  }
  // Generated alias: BBBBBB~N.EXT
  const baseSan = sanitize83(baseRaw).replace(/~/g, '_') || 'FILE';
  for (let n = 1; n < 1_000_000; n++) {
    const suffix = '~' + n;
    const stem = (baseSan.slice(0, 8 - suffix.length) + suffix).slice(0, 8);
    const s = pad83(stem, ext);
    if (!used.has(s)) {
      used.add(s);
      return s;
    }
  }
  throw new Error('fatImage: could not allocate a unique short name for ' + name);
}

/** LFN checksum of the 11-byte short name. */
function lfnChecksum(short11: string): number {
  let sum = 0;
  for (let i = 0; i < 11; i++) sum = (((sum & 1) << 7) + (sum >> 1) + short11.charCodeAt(i)) & 0xff;
  return sum;
}

export interface BuildFatOptions {
  /** Volume size in bytes. Default 8 MB (mirrors Wokwi). */
  volumeBytes?: number;
  /** 11-char volume label. */
  label?: string;
}

/** A file listed out of a FAT16 image by `readFat16Image`. */
export interface FatDirFile {
  /** Path from the card root, '/'-separated ("MUSIC/tracklist.txt"). Long
   *  names when LFN entries were present, else the 8.3 names. */
  name: string;
  size: number;
  data: Uint8Array;
}

function readU16(buf: Uint8Array, off: number): number {
  return buf[off] | (buf[off + 1] << 8);
}
function readU32(buf: Uint8Array, off: number): number {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

/** VFAT long-name entry: 13 UTF-16 code units in fixed byte slots. */
const LFN_SLOTS = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30];

/**
 * List every file of a FAT16 "super-floppy" image, subdirectories included,
 * and extract each file's bytes — the inverse of `buildFat16Image`, but
 * general enough for a card a guest OS (FatFs / Arduino SD) has written to:
 * it follows real cluster chains, honours sectors-per-cluster from the BPB,
 * decodes VFAT long names, skips deleted / volume-label entries and descends
 * directories (loops and runaway depth are guarded).
 *
 * Returns [] for anything that does not look like a mountable FAT16 volume —
 * the caller treats that as "no readable card", never as an error.
 */
export function readFat16Image(img: Uint8Array): FatDirFile[] {
  try {
    if (img.length < SEC || img[510] !== 0x55 || img[511] !== 0xaa) return [];
    const bytesPerSec = readU16(img, 11);
    const spc = img[13];
    const reserved = readU16(img, 14);
    const numFats = img[16];
    const rootEntries = readU16(img, 17);
    const fatSz = readU16(img, 22);
    if (!bytesPerSec || !spc || !reserved || !numFats || !fatSz || !rootEntries) return [];

    const fatStart = reserved * bytesPerSec;
    const rootStart = (reserved + numFats * fatSz) * bytesPerSec;
    const rootBytes = rootEntries * 32;
    const dataStart = rootStart + Math.ceil(rootBytes / bytesPerSec) * bytesPerSec;
    const clusterBytes = spc * bytesPerSec;
    if (dataStart >= img.length) return [];

    const clusterAt = (cl: number): number => dataStart + (cl - 2) * clusterBytes;
    const nextOf = (cl: number): number => readU16(img, fatStart + cl * 2);
    const isChain = (cl: number): boolean => cl >= 2 && cl < 0xfff8;

    /** Byte offsets of the 32-byte entries of a directory: the fixed root
     *  region, or a cluster chain for a subdirectory. */
    const entryOffsets = (startCluster: number | null): number[] => {
      const offs: number[] = [];
      if (startCluster === null) {
        for (let slot = 0; slot < rootEntries; slot++) offs.push(rootStart + slot * 32);
        return offs;
      }
      const seen = new Set<number>();
      for (let cl = startCluster; isChain(cl) && !seen.has(cl); cl = nextOf(cl)) {
        seen.add(cl);
        const at = clusterAt(cl);
        if (at + clusterBytes > img.length) break;
        for (let o = at; o < at + clusterBytes; o += 32) offs.push(o);
        if (seen.size > 65536) break;
      }
      return offs;
    };

    const readChain = (first: number, size: number): Uint8Array => {
      const data = new Uint8Array(size);
      let got = 0;
      let cluster = first;
      // Follow the chain; guard against loops with a step cap.
      for (let steps = 0; got < size && isChain(cluster); steps++) {
        if (steps > 1_000_000) break;
        const at = clusterAt(cluster);
        if (at >= img.length) break;
        const take = Math.min(clusterBytes, size - got, img.length - at);
        data.set(img.subarray(at, at + take), got);
        got += take;
        cluster = nextOf(cluster);
      }
      return got === size ? data : data.subarray(0, got);
    };

    const out: FatDirFile[] = [];
    const visitedDirs = new Set<number>();

    const walk = (startCluster: number | null, prefix: string, depth: number): void => {
      if (depth > 32) return;
      // LFN entries accumulate (in on-disk reverse order) until their 8.3 entry.
      let lfnParts: Array<{ seq: number; chars: string }> = [];
      for (const d of entryOffsets(startCluster)) {
        if (d + 32 > img.length) break;
        const first = img[d];
        if (first === 0x00) break; // end of directory
        if (first === 0xe5) {
          lfnParts = []; // deleted entry
          continue;
        }
        const attr = img[d + 11];
        if ((attr & 0x0f) === 0x0f) {
          let chars = '';
          for (const s of LFN_SLOTS) {
            const code = img[d + s] | (img[d + s + 1] << 8);
            if (code === 0x0000 || code === 0xffff) break;
            chars += String.fromCharCode(code);
          }
          lfnParts.push({ seq: img[d] & 0x1f, chars });
          continue;
        }
        if (attr & 0x08) {
          lfnParts = []; // volume label
          continue;
        }

        let name: string;
        if (lfnParts.length) {
          name = lfnParts
            .sort((a, b) => a.seq - b.seq)
            .map((p) => p.chars)
            .join('');
        } else {
          const base = String.fromCharCode(...img.subarray(d, d + 8)).trimEnd();
          const ext = String.fromCharCode(...img.subarray(d + 8, d + 11)).trimEnd();
          name = ext ? `${base}.${ext}` : base;
        }
        lfnParts = [];

        const cluster = readU16(img, d + 26);
        if (attr & 0x10) {
          // Directory: descend, skipping the self/parent links.
          if (name === '.' || name === '..') continue;
          if (!isChain(cluster) || visitedDirs.has(cluster)) continue;
          visitedDirs.add(cluster);
          walk(cluster, `${prefix}${name}/`, depth + 1);
          continue;
        }

        const size = readU32(img, d + 28);
        out.push({ name: prefix + name, size, data: readChain(cluster, size) });
      }
    };

    walk(null, '', 0);
    return out;
  } catch {
    return [];
  }
}

/** One directory of the tree `buildFat16Image` lays out. Children keyed by
 *  lower-cased segment so "Music" and "MUSIC" are one folder, as on FAT. */
interface DirNode {
  name: string;
  dirs: Map<string, DirNode>;
  files: SdFile[];
}

function buildTree(files: SdFile[]): DirNode {
  const root: DirNode = { name: '', dirs: new Map(), files: [] };
  for (const f of files) {
    const path = normalizeSdPath(f.name);
    if (!path) continue;
    const segs = path.split('/');
    let node = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const key = segs[i].toLowerCase();
      let child = node.dirs.get(key);
      if (!child) {
        child = { name: segs[i], dirs: new Map(), files: [] };
        node.dirs.set(key, child);
      }
      node = child;
    }
    const leaf = segs[segs.length - 1];
    // A file cannot share a name with a folder beside it; the folder wins
    // (it may hold other uploads), the file is dropped rather than aliased.
    if (node.dirs.has(leaf.toLowerCase())) continue;
    const idx = node.files.findIndex((x) => x.name.toLowerCase() === leaf.toLowerCase());
    const entry = { name: leaf, data: f.data };
    if (idx >= 0) node.files[idx] = entry;
    else node.files.push(entry);
  }
  return root;
}

/** VFAT long-name entries for `name` (empty when it fits 8.3), in the
 *  on-disk order: highest sequence first, right before the 8.3 entry. */
function lfnEntriesFor(name: string, short: string): Uint8Array[] {
  if (fitsShort(name)) return [];
  const entries: Uint8Array[] = [];
  const cksum = lfnChecksum(short);
  const chars = name + '\u0000'; // name + NUL terminator; rest padded 0xFFFF
  const count = Math.ceil(chars.length / 13);
  for (let seq = 1; seq <= count; seq++) {
    const e = new Uint8Array(32);
    e[0] = seq | (seq === count ? 0x40 : 0x00);
    e[11] = 0x0f; // LFN attribute
    e[13] = cksum;
    for (let k = 0; k < 13; k++) {
      const ci = (seq - 1) * 13 + k;
      const code = ci < chars.length ? chars.charCodeAt(ci) : 0xffff;
      e[LFN_SLOTS[k]] = code & 0xff;
      e[LFN_SLOTS[k] + 1] = (code >> 8) & 0xff;
    }
    entries.unshift(e); // reverse order
  }
  return entries;
}

/** A 32-byte 8.3 directory entry. */
function dirEntry(short11: string, attr: number, firstCluster: number, size: number): Uint8Array {
  const e = new Uint8Array(32);
  writeAscii(e, 0, short11, 11);
  e[11] = attr;
  writeU16(e, 20, 0); // first cluster (high word) — 0 for FAT16
  writeU16(e, 26, firstCluster); // first cluster (low word)
  writeU32(e, 28, size);
  return e;
}

const ATTR_VOLUME = 0x08;
const ATTR_DIR = 0x10;
const ATTR_ARCHIVE = 0x20;

/**
 * Build a FAT16 image containing `files`; a '/' in a name puts the file in
 * that folder (created as needed). Throws if the files don't fit the volume
 * or the root directory.
 */
export function buildFat16Image(files: SdFile[], opts: BuildFatOptions = {}): Uint8Array {
  const volumeBytes = opts.volumeBytes ?? 8 * 1024 * 1024;
  const totalSectors = Math.floor(volumeBytes / SEC);
  const spc = 1; // sectors per cluster
  const reserved = 1;
  const numFats = 2;
  const rootEntries = 512;
  const rootDirSectors = Math.ceil((rootEntries * 32) / SEC);

  // Iteratively size the FAT so it can map every data cluster.
  let fatSz = 1;
  for (;;) {
    const dataSectors = totalSectors - reserved - numFats * fatSz - rootDirSectors;
    const clusters = Math.floor(dataSectors / spc);
    const needed = Math.ceil(((clusters + 2) * 2) / SEC);
    if (needed <= fatSz) break;
    fatSz = needed;
  }
  const dataSectors = totalSectors - reserved - numFats * fatSz - rootDirSectors;
  const totalClusters = Math.floor(dataSectors / spc);
  if (totalClusters < 4085 || totalClusters > 65524) {
    throw new Error(`fatImage: cluster count ${totalClusters} outside FAT16 range — adjust volumeBytes`);
  }

  const img = new Uint8Array(totalSectors * SEC);

  // ── Boot sector / BPB (FAT16) ───────────────────────────────────────────
  img[0] = 0xeb;
  img[1] = 0x3c;
  img[2] = 0x90;
  writeAscii(img, 3, 'VELXIO  ', 8); // OEM name
  writeU16(img, 11, SEC); // bytes per sector
  img[13] = spc; // sectors per cluster
  writeU16(img, 14, reserved); // reserved sectors
  img[16] = numFats;
  writeU16(img, 17, rootEntries);
  writeU16(img, 19, totalSectors < 0x10000 ? totalSectors : 0); // total sectors (16)
  img[21] = 0xf8; // media descriptor (fixed disk)
  writeU16(img, 22, fatSz); // sectors per FAT
  writeU16(img, 24, 0x3f); // sectors per track
  writeU16(img, 26, 0xff); // num heads
  writeU32(img, 28, 0); // hidden sectors
  writeU32(img, 32, totalSectors < 0x10000 ? 0 : totalSectors); // total sectors (32)
  img[36] = 0x80; // drive number
  img[38] = 0x29; // extended boot signature
  writeU32(img, 39, 0x564c5849); // volume id ("VLXI")
  const label11 = ((opts.label ?? 'VELXIO SD').toUpperCase() + '           ').slice(0, 11);
  writeAscii(img, 43, label11, 11);
  writeAscii(img, 54, 'FAT16   ', 8);
  img[510] = 0x55;
  img[511] = 0xaa;

  // ── FAT regions ─────────────────────────────────────────────────────────
  const fat1 = reserved * SEC;
  const fat2 = (reserved + fatSz) * SEC;
  const setFat = (cluster: number, value: number): void => {
    writeU16(img, fat1 + cluster * 2, value);
    writeU16(img, fat2 + cluster * 2, value);
  };
  setFat(0, 0xfff8); // media descriptor in entry 0
  setFat(1, 0xffff); // end-of-chain marker in entry 1

  const rootStart = (reserved + numFats * fatSz) * SEC;
  const dataStart = (reserved + numFats * fatSz + rootDirSectors) * SEC;
  const clusterBytes = spc * SEC;
  const entriesPerCluster = clusterBytes / 32;

  let nextCluster = 2;
  /** Reserve a chain of `count` clusters, linked in the FAT; returns the
   *  first. The caller fills the data. */
  const allocChain = (count: number): number => {
    if (nextCluster + count - 1 > totalClusters + 1) {
      throw new Error(`fatImage: files exceed volume capacity (${volumeBytes} bytes)`);
    }
    const first = nextCluster;
    for (let i = 0; i < count; i++) {
      const cl = nextCluster++;
      setFat(cl, i === count - 1 ? 0xffff : cl + 1);
    }
    return first;
  };
  const writeChain = (first: number, bytes: Uint8Array): void => {
    let cl = first;
    for (let off = 0; off < bytes.length; off += clusterBytes) {
      img.set(bytes.subarray(off, off + clusterBytes), dataStart + (cl - 2) * clusterBytes);
      cl = readU16(img, fat1 + cl * 2);
    }
  };

  /**
   * Lay out one directory: reserve its own clusters first (a subdirectory's
   * listing size is known from its children's names alone), then place the
   * children, whose first clusters the entries need, then write the entries.
   * Returns the directory's first cluster (0 for the root, which lives in
   * the fixed root region).
   */
  const layoutDir = (node: DirNode, parentCluster: number, isRoot: boolean): number => {
    const used = new Set<string>(); // short-name uniqueness within THIS directory
    type Planned = { short: string; lfn: Uint8Array[]; dir?: DirNode; file?: SdFile };
    const planned: Planned[] = [];
    for (const dir of node.dirs.values()) {
      const short = shortNameFor(dir.name, used);
      planned.push({ short, lfn: lfnEntriesFor(dir.name, short), dir });
    }
    for (const file of node.files) {
      const short = shortNameFor(file.name, used);
      planned.push({ short, lfn: lfnEntriesFor(file.name, short), file });
    }
    const entryCount = planned.reduce((n, p) => n + p.lfn.length + 1, isRoot ? 0 : 2);

    let selfCluster = 0;
    if (isRoot) {
      // +1: the volume-label entry below.
      if (entryCount + 1 > rootEntries) {
        throw new Error('fatImage: too many files for the root directory (max 512 entries)');
      }
    } else {
      selfCluster = allocChain(Math.max(1, Math.ceil(entryCount / entriesPerCluster)));
    }

    const entries: Uint8Array[] = [];
    if (isRoot) {
      // The label the boot sector carries, as the root's own entry too: a
      // checker (fsck.fat) treats a boot-sector label without one as a fault.
      entries.push(dirEntry(label11, ATTR_VOLUME, 0, 0));
    } else {
      entries.push(dirEntry('.          ', ATTR_DIR, selfCluster, 0));
      entries.push(dirEntry('..         ', ATTR_DIR, parentCluster, 0));
    }
    for (const p of planned) {
      let first: number;
      let attr: number;
      let size = 0;
      if (p.dir) {
        first = layoutDir(p.dir, selfCluster, false);
        attr = ATTR_DIR;
      } else {
        const data = p.file!.data;
        size = data.length;
        first = allocChain(Math.max(1, Math.ceil(size / clusterBytes)));
        writeChain(first, data);
        attr = ATTR_ARCHIVE;
      }
      entries.push(...p.lfn, dirEntry(p.short, attr, first, size));
    }

    if (isRoot) {
      entries.forEach((e, i) => img.set(e, rootStart + i * 32));
    } else {
      const listing = new Uint8Array(entries.length * 32);
      entries.forEach((e, i) => listing.set(e, i * 32));
      writeChain(selfCluster, listing);
    }
    return selfCluster;
  };

  layoutDir(buildTree(files), 0, true);
  return img;
}
