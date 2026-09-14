/**
 * fat-image-mtools.test.ts — the image `buildFat16Image` emits, checked by a
 * FAT implementation that is not ours: dosfstools' fsck.fat (structure) and
 * mtools' mdir (a recursive listing, long names included). Our own reader
 * shares assumptions with our writer; a real card reader does not.
 *
 * Skipped where the tools are not installed (CI without dosfstools/mtools);
 * runs on any dev box with `apt install dosfstools mtools`.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFat16Image } from '../utils/fatImage';

const have = (bin: string): boolean => spawnSync('which', [bin]).status === 0;
const tools = have('fsck.fat') && have('mdir');

describe.skipIf(!tools)('FAT16 image vs dosfstools + mtools', () => {
  const enc = (t: string) => new TextEncoder().encode(t);

  it('fsck.fat finds no errors and mdir lists every path, folders included', () => {
    const dir = mkdtempSync(join(tmpdir(), 'velxio-fat-'));
    const path = join(dir, 'card.img');
    try {
      const img = buildFat16Image([
        { name: 'MUSIC/tracklist.txt', data: enc('Blue Monday\n') },
        { name: 'MUSIC/album one/song.wav', data: new Uint8Array(1500).fill(9) },
        { name: 'readme.txt', data: enc('root') },
        { name: 'a/b/c/deep.bin', data: new Uint8Array([1, 2, 3]) },
        { name: 'holiday picture 2026.jpeg', data: enc('jpg') },
      ]);
      writeFileSync(path, img);

      // -n: never modify; exit status 0 = clean. Its stdout names any
      // problem (bad "." / ".." entries, wrong chains, orphan clusters).
      const fsck = spawnSync('fsck.fat', ['-n', '-v', path], { encoding: 'utf8' });
      const report = fsck.stdout + fsck.stderr;
      expect(report, report).not.toMatch(/error|invalid|orphan|wrong/i);
      expect(fsck.status, report).toBe(0);

      // mdir -/ recurses; -b prints bare paths ("::/MUSIC/tracklist.txt").
      const listing = execFileSync('mdir', ['-i', path, '-/', '-b', '::'], { encoding: 'utf8' });
      const paths = listing
        .split('\n')
        .map((l) => l.trim().replace(/^::\/?/, ''))
        .filter(Boolean);
      for (const want of [
        'MUSIC/tracklist.txt',
        'MUSIC/album one/song.wav',
        'readme.txt',
        'a/b/c/deep.bin',
        'holiday picture 2026.jpeg',
      ]) {
        expect(paths.map((p) => p.toLowerCase())).toContain(want.toLowerCase());
      }

      // And the bytes come back through mtools intact.
      const song = execFileSync('mcopy', ['-i', path, '::/MUSIC/album one/song.wav', '-'], {
        encoding: 'buffer',
      });
      expect(song.length).toBe(1500);
      expect(song.every((b) => b === 9)).toBe(true);
      const text = execFileSync('mcopy', ['-i', path, '::/MUSIC/tracklist.txt', '-'], {
        encoding: 'utf8',
      });
      expect(text).toBe('Blue Monday\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
