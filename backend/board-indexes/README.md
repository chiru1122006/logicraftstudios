# Vendored board-manager indexes

Snapshot copies of third-party Arduino board-manager indexes whose hosting
has a history of outages breaking builds and fresh deployments.

## Why this exists

`package_drazzy.com_index.json` (Spence Konde's ATTinyCore index) is served
from drazzy.com, which has repeatedly had TLS problems — most recently a
certificate that expired on 2026-06-22 and stayed expired for weeks, while
the host also began 301-redirecting `http://` to `https://`, defeating the
plain-http URL we pin to sidestep exactly this. See issue #254.

Two things go wrong when that host is down:

1. `arduino-cli core update-index` exits non-zero, so any image build that
   runs it in a `RUN ... && ...` chain fails hard.
2. Worse, at runtime: if the arduino-cli config references the index URL but
   the index *file* was never downloaded, arduino-cli fails instance
   initialization outright — which breaks every compile, including boards
   that have nothing to do with ATtiny.

A stale index is fine (we pin ATTinyCore 1.4.1, whose platform archive and
micronucleus tool both download from github.com, not drazzy.com/azduino.com).
A missing index is not. So we vendor the index and seed it wherever it could
be missing:

- `Dockerfile.standalone` copies this directory to `/opt/arduino15-seed/`;
  `docker/entrypoint.sh` copies any missing `package_*.json` into
  `/root/.arduino15/` at boot. This also heals pre-existing named volumes
  created by older images (the actual trigger of issue #254).
- `backend/Dockerfile` copies the index into `/root/.arduino15/` before
  running a now-tolerant `core update-index`.

## Refreshing the snapshot

When drazzy.com is healthy:

```sh
curl -fL https://drazzy.com/package_drazzy.com_index.json \
    -o backend/board-indexes/package_drazzy.com_index.json
```

There is no need to refresh on a schedule — the file only has to be recent
enough to describe the pinned ATTinyCore version.
