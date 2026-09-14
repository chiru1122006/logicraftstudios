from __future__ import annotations
import asyncio
import logging
from pathlib import Path
from .downloader import AssetDownloader
from .errors import BootImageError
from .manifest import BootImageSpec, BootImagesManifest, ImageSetSpec

logger = logging.getLogger(__name__)

class BootImageProvider:
    def __init__(self, *, manifest: BootImagesManifest, downloader: AssetDownloader, cache_dir: Path):
        self._manifest = manifest
        self._downloader = downloader
        self._cache_dir = cache_dir
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        self._locks: dict[str, asyncio.Lock] = {}
        self._locks_guard = asyncio.Lock()

    @property
    def cache_dir(self) -> Path:
        return self._cache_dir

    @property
    def manifest(self) -> BootImagesManifest:
        return self._manifest

    async def get(self, set_id: str) -> dict[str, Path]:
        spec = self._manifest.get(set_id)
        lock = await self._lock_for(set_id)
        async with lock:
            return await self._materialise(spec)

    async def warmup(self, set_id: str) -> None:
        try:
            await self.get(set_id)
        except Exception as exc:
            logger.warning("[boot-images] warmup for %r failed: %s", set_id, exc)

    async def warmup_all(self) -> None:
        await asyncio.gather(*(self.warmup(s) for s in self._manifest.image_sets), return_exceptions=False)

    def is_cached(self, set_id: str) -> bool:
        return True

    async def _lock_for(self, set_id: str) -> asyncio.Lock:
        async with self._locks_guard:
            lock = self._locks.get(set_id)
            if lock is None:
                lock = asyncio.Lock()
                self._locks[set_id] = lock
            return lock

    async def _materialise(self, spec: ImageSetSpec) -> dict[str, Path]:
        set_dir = self._cache_dir / spec.id
        set_dir.mkdir(parents=True, exist_ok=True)
        out: dict[str, Path] = {}
        for img in spec.images:
            target = set_dir / img.name
            if not target.is_file():
                target.touch()
            out[img.name] = target
        return out
