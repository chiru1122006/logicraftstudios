"""The artifact cache must not outlive a change to how binaries are built.

`_toolchain_epoch()` is folded into every cache key so a build-flag change
invalidates every stored image. The CONFIG_* lines do not live in the Python
modules, though — they live in the esp-idf-template tree, so that tree has to
be part of the fingerprint too. It was not, and turning FatFs long names on
reached only sketches nobody had compiled before: everything already cached
kept its stale image (measured on prod, 2026-09-06).
"""
from __future__ import annotations

from pathlib import Path

from app.api.routes import compile as compile_route


def _template_dir() -> Path:
    return Path(compile_route.__file__).resolve().parents[2] / "services" / "esp-idf-template"


def test_epoch_is_stable_when_nothing_changes() -> None:
    assert compile_route._toolchain_epoch() == compile_route._toolchain_epoch()


def test_sdkconfig_template_change_changes_the_epoch() -> None:
    path = _template_dir() / "sdkconfig.defaults.in"
    before = compile_route._toolchain_epoch()
    original = path.read_bytes()
    try:
        path.write_bytes(original + b"\nCONFIG_VELXIO_TEST_ONLY=y\n")
        assert compile_route._toolchain_epoch() != before
    finally:
        path.write_bytes(original)
    assert compile_route._toolchain_epoch() == before


def test_any_template_file_change_changes_the_epoch() -> None:
    # main.cpp and the partition table shape the image just as much as the
    # sdkconfig does; a new file in the tree counts as well.
    for name in ("main/main.cpp", "partitions.csv", "CMakeLists.txt"):
        path = _template_dir() / name
        before = compile_route._toolchain_epoch()
        original = path.read_bytes()
        try:
            path.write_bytes(original + b"\n// velxio test\n")
            assert compile_route._toolchain_epoch() != before, name
        finally:
            path.write_bytes(original)
        assert compile_route._toolchain_epoch() == before, name

    new_file = _template_dir() / "velxio_epoch_probe.tmp"
    before = compile_route._toolchain_epoch()
    try:
        new_file.write_bytes(b"probe")
        assert compile_route._toolchain_epoch() != before
    finally:
        new_file.unlink(missing_ok=True)
    assert compile_route._toolchain_epoch() == before
