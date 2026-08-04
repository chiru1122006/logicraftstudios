// Open-source no-op stub for `@pro/data/proExamples` (see vite.config.ts).
// OSS builds ship NO pro examples — the Pico W WiFi showcase is a paid overlay
// feature, so the velxio-prod overlay replaces this with the real list at build
// time (VITE_PRO_BUILD=true + PRO_OVERLAY_PATH). The static import in
// data/examples.ts resolves here in OSS, contributing an empty spread.
import type { ExampleProject } from '../../data/examples';

export const proExamples: ExampleProject[] = [];
