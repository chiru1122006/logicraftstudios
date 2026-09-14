"""
QemuManager — backend service for Raspberry Pi simulator emulation via QEMU.

Architecture
------------
Each Pi board instance gets:
  - qemu-system-aarch64 process (-M virt -cpu cortex-a53 for Pi 3, other
    cpu models for the rest of the family — see Phase 3 plan)
  - Velxio-built kernel + initramfs + rootfs (not the rpi-firmware kernel
    and not raspios; see ``project/pi-emulation/`` for why)
  - virtio-blk root from a qcow2 overlay over the cached rootfs ext4
  - virtio-console on chardev 0 (TCP socket) — the user shell at /dev/hvc0
  - virtio-serial port on chardev 1 (TCP socket) — multiplexed text
    protocol channel for GPIO/I2C/SPI/UART/PWM (Phase 2 wires it up)

We were on ``-M raspi3b`` previously but QEMU 10 + kernel 6.12 had a
pl011 RX bug that broke userspace tty open — see
``project/pi-emulation/decisions.md`` for the full debugging trail.
The ``raspberry-pi-3`` manifest entry remains around (marked deprecated)
to ease rollback; ``raspberry-pi-3-virt`` is the live one.

Boot files are resolved at runtime via BootImageProvider (downloads,
verifies, caches under /var/cache/velxio/boot-images/...). The lifespan
hook at the bottom pre-warms the cache so first-time user requests
don't pay the download latency.

Protocol channel (chardev 1) — wired by Phase 2's pi_protocol_mux
  Pi  → backend :  "GPIO <bcm> <0|1>\\n"   (also I2C/SPI/UART/PWM lines)
  backend → Pi  :  "SET <bcm> <0|1>\\n"    and reply frames
"""

import asyncio
import logging
import os
import socket
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable, Awaitable

from app.core.hooks import register_lifespan_startup
from app.services.boot_images import (
    BootImageError,
    BootImageProvider,
    get_default_provider,
)

logger = logging.getLogger(__name__)

# Per-board configuration. Pi 3/4/5 share the same arm64 image set;
# Pi Zero/1/2 (Phase 3 deliverable) will share an armhf image set.
# Only -cpu, -smp, -m, qemu binary and which image-set the provider
# fetches vary per model.
#
# CPU choice notes:
#   raspberry-pi-3 → Cortex-A53 (BCM2837, ARMv8 64-bit)
#   raspberry-pi-4 → Cortex-A72 (BCM2711, ARMv8 64-bit)
#   raspberry-pi-5 → Cortex-A76 (BCM2712, ARMv8 64-bit)
PI_CONFIGS: dict[str, dict] = {
    'raspberry-pi-3': {
        'qemu':       'qemu-system-aarch64',
        'cpu':        'cortex-a53',
        'smp':        '4',
        'memory':     '1G',
        'image_set':  'raspberry-pi-3-virt',
        'kernel':     'velxio-kernel-arm64',
        'initramfs':  'velxio-initramfs-arm64.cpio.gz',
        'rootfs':     'velxio-pi-rootfs-arm64.ext4',
        'bus':        'pci',
    },
    'raspberry-pi-4': {
        'qemu':       'qemu-system-aarch64',
        'cpu':        'cortex-a72',
        'smp':        '4',
        'memory':     '2G',
        'image_set':  'raspberry-pi-3-virt',   # same arm64 image set as Pi 3
        'kernel':     'velxio-kernel-arm64',
        'initramfs':  'velxio-initramfs-arm64.cpio.gz',
        'rootfs':     'velxio-pi-rootfs-arm64.ext4',
        'bus':        'pci',
    },
    'raspberry-pi-5': {
        'qemu':       'qemu-system-aarch64',
        'cpu':        'cortex-a76',
        'smp':        '4',
        'memory':     '2G',
        'image_set':  'raspberry-pi-3-virt',   # same arm64 image set
        'kernel':     'velxio-kernel-arm64',
        'initramfs':  'velxio-initramfs-arm64.cpio.gz',
        'rootfs':     'velxio-pi-rootfs-arm64.ext4',
        'bus':        'pci',
    },
    # ── armhf (32-bit ARM, Pi Zero / 1 / 2) ─────────────────────────────
    # QEMU virt for arm-32 does not probe PCI cleanly (the pci-host-generic
    # node is missing the "reg" DT property and probe fails -75), so we
    # use the MMIO virtio transport instead: -device virtio-blk-device /
    # virtio-serial-device. The kernel here is linux-image-armmp (Debian
    # generic ARMv7) which ships ext4 + virtio_mmio as MODULES — the
    # armhf initramfs bundles ext4.ko + jbd2.ko + mbcache.ko + crc16.ko +
    # crc32c_generic.ko and insmods them in dep order before /dev/vda
    # mount. Pi Zero / Pi 1 are ARMv6 which the Debian armmp kernel does
    # not target; Phase 3.3b tracks sourcing an ARMv6 kernel for those.
    'raspberry-pi-2': {
        'qemu':       'qemu-system-arm',
        'cpu':        'cortex-a7',
        'smp':        '4',
        'memory':     '1G',
        'image_set':  'raspberry-pi-armhf',
        'kernel':     'velxio-kernel-armhf',
        'initramfs':  'velxio-initramfs-armhf.cpio.gz',
        'rootfs':     'velxio-pi-rootfs-armhf.ext4',
        'bus':        'mmio',
    },
    # Pi 1 / Pi Zero are ARMv6 on real silicon (arm1176, BCM2835). Debian
    # dropped the ARMv6 kernel and Alpine's linux-rpi kernel is wired for
    # the actual BCM2835 hardware (no virtio_blk, no ext4 module) so it
    # cannot boot on QEMU virt. We follow the project's "looks-like-a-Pi
    # but isn't-exactly-a-Pi" architecture rule: serve them off the same
    # ARMv7 armmp kernel as Pi 2, with the smaller RAM / SMP profile of
    # the real boards. User code that uses RPi.GPIO / smbus2 / spidev
    # behaves identically. We do not advertise ARMv6 anywhere in the
    # rootfs (no /proc/cpuinfo lying).
    'raspberry-pi-1': {
        'qemu':       'qemu-system-arm',
        'cpu':        'cortex-a7',
        'smp':        '1',
        'memory':     '512M',
        'image_set':  'raspberry-pi-armhf',
        'kernel':     'velxio-kernel-armhf',
        'initramfs':  'velxio-initramfs-armhf.cpio.gz',
        'rootfs':     'velxio-pi-rootfs-armhf.ext4',
        'bus':        'mmio',
    },
    'raspberry-pi-zero': {
        'qemu':       'qemu-system-arm',
        'cpu':        'cortex-a7',
        'smp':        '1',
        'memory':     '512M',
        'image_set':  'raspberry-pi-armhf',
        'kernel':     'velxio-kernel-armhf',
        'initramfs':  'velxio-initramfs-armhf.cpio.gz',
        'rootfs':     'velxio-pi-rootfs-armhf.ext4',
        'bus':        'mmio',
    },
}

# Default board if the client doesn't specify one. Kept for clients
# that still send the legacy "start_pi" message without a board field.
DEFAULT_PI_BOARD = 'raspberry-pi-3'


# ── Pluggable I2C/SPI/UART dispatcher ────────────────────────────────────
#
# When the pro overlay loads, it can call
# ``set_pi_protocol_dispatcher(fn)`` to register a coroutine that
# receives the raw protocol tokens for I2C/SPI/UART frames. If the
# dispatcher returns a non-None string, that string is written back
# to the guest as a reply line. Returning None falls through to the
# default no-slave stubs.
#
# Signature: async def(client_id: str, tokens: list[str]) -> str | None
#
# This keeps the upstream OSS code unaware of the pro slave models
# (BME280, MCP23017, ...) while letting the overlay attach real
# behaviour at register_pro() time.
import typing as _typing
_ProtocolDispatcher = _typing.Callable[
    [str, list[str]],
    _typing.Awaitable[_typing.Optional[str]],
]
_PI_PROTOCOL_DISPATCHER: _ProtocolDispatcher | None = None


def set_pi_protocol_dispatcher(fn: _ProtocolDispatcher | None) -> None:
    """Install (or clear) the pro overlay's I2C/SPI/UART dispatcher."""
    global _PI_PROTOCOL_DISPATCHER
    _PI_PROTOCOL_DISPATCHER = fn


# Pro overlay can also register a handler for attach/detach WebSocket
# messages from the canvas (e.g. when the user wires a BME280 to the Pi).
# Signature: async def(client_id: str, action: str, data: dict) -> None
# where action is 'attach' or 'detach'.
_SlaveHandler = _typing.Callable[
    [str, str, dict],
    _typing.Awaitable[None],
]
_PI_SLAVE_HANDLER: _SlaveHandler | None = None


def set_pi_slave_handler(fn: _SlaveHandler | None) -> None:
    """Install (or clear) the pro overlay's slave attach/detach handler."""
    global _PI_SLAVE_HANDLER
    _PI_SLAVE_HANDLER = fn


def get_pi_slave_handler() -> _SlaveHandler | None:
    return _PI_SLAVE_HANDLER


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


EventCallback = Callable[[str, dict], Awaitable[None]]


class PiInstance:
    """State for one running Pi board."""

    def __init__(self, client_id: str, callback: EventCallback,
                 board_type: str = DEFAULT_PI_BOARD):
        self.client_id  = client_id
        self.callback   = callback
        self.board_type = board_type

        # Runtime state
        self.process:      subprocess.Popen | None = None
        self.overlay_path: str | None = None
        self.serial_port:  int = 0   # virtio-console TCP port (/dev/hvc0)
        self.gpio_port:    int = 0   # legacy field (kept for log compat)
        self.proto_pipe_base: str | None = None   # pipe chardev FIFO basename
        self._serial_writer: asyncio.StreamWriter | None = None
        self._gpio_writer:   asyncio.StreamWriter | None = None
        # File descriptors for the proto pipe pair (host side).
        self._proto_in_fd:  int | None = None  # we write here → guest reads
        self._proto_out_fd: int | None = None  # we read here  ← guest writes
        self._tasks: list[asyncio.Task] = []
        self.running = False

    async def emit(self, event_type: str, data: dict) -> None:
        try:
            await self.callback(event_type, data)
        except Exception as e:
            logger.error('emit(%s): %s', event_type, e)


class QemuManager:
    def __init__(self, provider: BootImageProvider | None = None):
        self._instances: dict[str, PiInstance] = {}
        # The provider is resolved lazily on first boot so importing
        # this module never triggers a download or even a manifest
        # parse. Injected via the constructor for tests; production
        # uses `get_default_provider()` on first use.
        self._provider = provider

    # ── Public API ────────────────────────────────────────────────────────────

    def start_instance(self, client_id: str, board_type: str,
                       callback: EventCallback) -> None:
        if client_id in self._instances:
            logger.warning('start_instance: %s already running', client_id)
            return
        if board_type not in PI_CONFIGS:
            logger.warning(
                'start_instance: unknown board %r, falling back to %s',
                board_type, DEFAULT_PI_BOARD,
            )
            board_type = DEFAULT_PI_BOARD
        inst = PiInstance(client_id, callback, board_type=board_type)
        self._instances[client_id] = inst
        asyncio.create_task(self._boot(inst))

    def stop_instance(self, client_id: str) -> None:
        inst = self._instances.pop(client_id, None)
        if inst:
            asyncio.create_task(self._shutdown(inst))

    def set_pin_state(self, client_id: str, pin: str | int, state: int) -> None:
        """Drive a GPIO pin from outside (e.g. connected Arduino)."""
        inst = self._instances.get(client_id)
        if inst and inst._gpio_writer:
            asyncio.create_task(self._send_gpio(inst, int(pin), bool(state)))

    async def send_serial_bytes(self, client_id: str, data: bytes) -> None:
        inst = self._instances.get(client_id)
        if not inst:
            logger.warning('send_serial_bytes: no instance for client_id=%s', client_id)
            return
        if not inst._serial_writer:
            logger.warning('send_serial_bytes: %s has no serial writer (qemu not connected yet?)', client_id)
            return
        logger.info('send_serial_bytes: %s sending %d bytes: %r',
                    client_id, len(data), bytes(data[:32]))
        inst._serial_writer.write(data)
        try:
            await inst._serial_writer.drain()
        except Exception as e:
            logger.warning('send_serial_bytes drain: %s', e)

    # ── Boot sequence ─────────────────────────────────────────────────────────

    async def _boot(self, inst: PiInstance) -> None:
        # Per-board configuration drives the QEMU command, image-set,
        # CPU type, RAM, and SMP count. See PI_CONFIGS at the top of
        # this module.
        cfg = PI_CONFIGS[inst.board_type]
        logger.info('[%s] booting %s (cpu=%s mem=%s)',
                    inst.client_id, inst.board_type, cfg['cpu'], cfg['memory'])

        # Ensure platform supports FIFO pipes and Linux QEMU
        if sys.platform == 'win32' or not hasattr(os, 'mkfifo'):
            await inst.emit('error', {
                'message': 'Raspberry Pi Linux emulation requires a Linux server with QEMU. Please point your backend to Azure (http://104.214.172.50).'
            })
            self._instances.pop(inst.client_id, None)
            return

        # Resolve boot files via the provider (downloads + verifies on
        # first call; cache hit on subsequent calls thanks to the
        # lifespan pre-warm at module load).
        try:
            images = await self._get_provider().get(cfg['image_set'])
        except BootImageError as exc:
            logger.error('[%s] boot-image provisioning failed: %s',
                         inst.client_id, exc)
            # OSS / self-hosted has no boot-image downloader configured (no
            # license key) -> frame Raspberry Pi as the Pro feature it is,
            # rather than surfacing a raw "not configured" provisioning error.
            # A genuine boot failure on velxio.dev still shows the detail.
            from app.services.board_access import PRO_BOARD_MESSAGE
            if 'not configured' in str(exc).lower():
                message = PRO_BOARD_MESSAGE
            else:
                message = f'{inst.board_type} boot files unavailable: {exc}'
            await inst.emit('error', {'message': message})
            self._instances.pop(inst.client_id, None)
            return
        kernel_path:    Path = images[cfg['kernel']]
        initramfs_path: Path = images[cfg['initramfs']]
        rootfs_base:    Path = images[cfg['rootfs']]

        # Allocate transport endpoints for the two chardevs.
        #
        # User console: TCP socket — virtconsole on top of a socket
        # works bidirectionally (proven by Phase 1).
        #
        # Protocol channel: pipe (FIFO pair on disk) — `virtserialport`
        # on a socket chardev has a guest→host flow bug in QEMU 10
        # (data is silently dropped). Pipe chardev sidesteps that;
        # see project/pi-emulation/decisions.md D9.
        inst.serial_port = _find_free_port()
        inst.gpio_port   = _find_free_port()

        # Create overlay qcow2 backed by the velxio rootfs ext4. Each
        # session gets its own writable layer; reads cascade down to
        # the shared base, writes go into the per-session overlay
        # which is deleted on stop.
        overlay = tempfile.NamedTemporaryFile(suffix='.qcow2', delete=False)
        overlay.close()
        inst.overlay_path = overlay.name
        try:
            subprocess.run(
                ['qemu-img', 'create', '-f', 'qcow2',
                 '-b', str(rootfs_base), '-F', 'raw',
                 inst.overlay_path],
                check=True, capture_output=True,
            )
        except subprocess.CalledProcessError as e:
            await inst.emit('error',
                            {'message': f'qemu-img create failed: '
                                        f'{e.stderr.decode()}'})
            self._instances.pop(inst.client_id, None)
            return

        # Build QEMU command for -M virt + virtio devices.
        #
        # Why virt: see project/pi-emulation/decisions.md (D1). Short
        # version: raspi3b pl011 RX is broken in QEMU 10 + kernel 6.12,
        # virtio-console isn't.
        #
        # Why no -dtb: virt machine generates its own DTB on the fly
        # from the runtime device list, so we don't ship one.
        # Virtio device suffix depends on the bus. arm64 virt has
        # working PCI so we use the -pci variants there. arm-32 virt's
        # pci-host-generic node has a broken DT (missing "reg" property)
        # so the bus never enumerates — we have to fall back to the
        # mmio variants. The same device names work for both blk and
        # serial; only the suffix changes.
        bus = cfg.get('bus', 'pci')
        if bus == 'mmio':
            blk_dev    = 'virtio-blk-device,drive=rootfs'
            serial_dev = 'virtio-serial-device,id=virtio-serial0'
        else:
            blk_dev    = 'virtio-blk-pci,drive=rootfs'
            serial_dev = 'virtio-serial-pci,id=virtio-serial0'

        cmd = [
            cfg['qemu'],
            '-M',      'virt',
            '-cpu',    cfg['cpu'],
            '-smp',    cfg['smp'],
            '-m',      cfg['memory'],
            '-kernel', str(kernel_path),
            '-initrd', str(initramfs_path),
            # Root filesystem via virtio-blk. arm64 uses the pci
            # transport (works out of the box on virt-aarch64); armhf
            # uses the mmio transport because PCI is broken on
            # virt-arm32.
            '-drive',  f'if=none,file={inst.overlay_path},format=qcow2,id=rootfs',
            '-device', blk_dev,
            # No default network / display / monitor / serial — we add
            # exactly the two chardev-backed virtio-serial ports we
            # need.  -nographic auto-binds -serial mon:stdio which
            # collides with our explicit -chardev IDs.
            '-nic',     'none',
            '-display', 'none',
            '-monitor', 'none',
            # Console: TCP chardev on PL011 UART 0 (/dev/ttyAMA0).
            # The frontend serial WebSocket connects to this port.
            '-serial',  f'tcp:127.0.0.1:{inst.serial_port},server=on,wait=off',
            # Protocol / GPIO channel: TCP chardev on PL011 UART 1 (/dev/ttyAMA1).
            # Streams pin changes from python/gpiozero live to frontend canvas.
            '-serial',  f'tcp:127.0.0.1:{inst.gpio_port},server=on,wait=off',
            # Kernel cmdline:
            #   console=ttyAMA0,115200 — PL011 UART user terminal.
            #   rdinit=/init — mounts proc/sys/dev/home/pi and runs shell.
            #   panic=10 — auto-reboot 10 s after a panic.
            '-append', 'console=ttyAMA0,115200 rdinit=/init panic=10',
        ]


        logger.info('Launching QEMU for %s: %s',
                    inst.client_id, ' '.join(cmd))

        # Use subprocess.Popen via executor — asyncio.create_subprocess_exec
        # requires ProactorEventLoop on Windows but uvicorn may use
        # SelectorEventLoop.
        loop = asyncio.get_running_loop()
        try:
            inst.process = await loop.run_in_executor(
                None,
                lambda: subprocess.Popen(
                    cmd,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    stdin=subprocess.DEVNULL,
                ),
            )
        except FileNotFoundError:
            await inst.emit('error',
                            {'message': 'qemu-system-aarch64 not found in PATH'})
            self._instances.pop(inst.client_id, None)
            return

        inst.running = True
        await inst.emit('system', {'event': 'booting'})

        # Give QEMU a moment to open its TCP sockets
        await asyncio.sleep(1.0)

        # Connect to the two chardev TCP ports.
        inst._tasks.append(asyncio.create_task(self._connect_serial(inst)))
        inst._tasks.append(asyncio.create_task(self._connect_gpio(inst)))
        inst._tasks.append(asyncio.create_task(self._watch_stderr(inst)))

    # ── Console (virtio-console / /dev/hvc0) ──────────────────────────────────

    async def _connect_serial(self, inst: PiInstance) -> None:
        for attempt in range(10):
            try:
                reader, writer = await asyncio.open_connection(
                    '127.0.0.1', inst.serial_port,
                )
                inst._serial_writer = writer
                logger.info('%s: serial connected on port %d',
                            inst.client_id, inst.serial_port)
                await inst.emit('system', {'event': 'booted'})
                await self._read_serial(inst, reader)
                return
            except (ConnectionRefusedError, OSError):
                await asyncio.sleep(1.0 * (attempt + 1))
        await inst.emit('error',
                        {'message': 'Could not connect to QEMU console port'})

    async def _read_serial(self, inst: PiInstance,
                            reader: asyncio.StreamReader) -> None:
        buf = bytearray()
        logger.info('%s: _read_serial started (running=%s)', inst.client_id, inst.running)
        read_count = 0
        timeout_count = 0
        while inst.running:
            try:
                chunk = await asyncio.wait_for(reader.read(256), timeout=0.1)
                if not chunk:
                    logger.warning('%s: _read_serial got empty chunk (EOF), breaking', inst.client_id)
                    break
                read_count += 1
                buf.extend(chunk)
                text = buf.decode('utf-8', errors='replace')
                buf.clear()
                if read_count <= 5 or read_count % 50 == 0:
                    logger.info('%s: serial read #%d len=%d: %r',
                                inst.client_id, read_count, len(text), text[:80])
                await inst.emit('serial_output', {'data': text})
            except asyncio.TimeoutError:
                timeout_count += 1
                if timeout_count <= 3 or timeout_count % 500 == 0:
                    logger.debug('%s: _read_serial timeout #%d', inst.client_id, timeout_count)
                continue
            except Exception as e:
                logger.warning('%s serial read: %s', inst.client_id, e)
                break
        logger.info('%s: _read_serial exited (running=%s, reads=%d, timeouts=%d)',
                    inst.client_id, inst.running, read_count, timeout_count)

    # ── Protocol / GPIO channel (PL011 UART 1 / /dev/ttyAMA1) ─────────────────
    # Connects to QEMU's second serial port on inst.gpio_port.
    # Receives real-time GPIO updates (e.g. GPIO 17 1) from python/gpiozero
    # and dispatches to the frontend. Sends inputs (e.g. SET 2 1) to guest.

    async def _connect_gpio(self, inst: PiInstance) -> None:
        """Connect to QEMU's second PL011 UART on inst.gpio_port."""
        for attempt in range(10):
            try:
                reader, writer = await asyncio.open_connection(
                    '127.0.0.1', inst.gpio_port,
                )
                inst._gpio_writer = writer
                logger.info('%s: gpio channel connected on port %d',
                            inst.client_id, inst.gpio_port)
                await self._read_gpio(inst, reader)
                return
            except (ConnectionRefusedError, OSError):
                await asyncio.sleep(1.0 * (attempt + 1))
        logger.warning('%s: could not connect to QEMU gpio port', inst.client_id)

    async def _read_gpio(self, inst: PiInstance,
                         reader: asyncio.StreamReader) -> None:
        while inst.running:
            try:
                line_bytes = await reader.readline()
                if not line_bytes:
                    break
                line = line_bytes.decode('ascii', errors='ignore').strip()
                if line:
                    asyncio.create_task(self._handle_gpio_line(inst, line))
            except Exception as e:
                logger.warning('%s gpio read error: %s', inst.client_id, e)
                break

    async def _handle_gpio_line(self, inst: PiInstance, line: str) -> None:
        """Dispatch a single text-protocol line from the Pi shim layer.

        Phase 2 supports the velxio Pi shim wire format:
          GPIO <bcm> <0|1>                  → gpio_change event
          GPIO_SETUP <bcm> <in|out> <pud>   → noted (no canvas effect)
          GPIO_IN <bcm>                     → reply VAL <bcm> <0|1>
          PWM_START <bcm> <freq> <duty>     → gpio_pwm event
          PWM_CHANGE <bcm> <freq> <duty>    → gpio_pwm event
          PWM_STOP <bcm>                    → gpio_pwm stop
          I2C / SPI / UART …                → reply I2C_ERR / SPI_DATA empty
        """
        parts = line.split()
        if not parts:
            return
        op = parts[0]

        if op == 'GPIO' and len(parts) == 3:
            try:
                pin   = int(parts[1])
                state = int(parts[2])
                await inst.emit('gpio_change',
                                {'pin': pin, 'state': state})
            except ValueError:
                pass
            return

        if op == 'GPIO_SETUP' and len(parts) >= 3:
            try:
                pin = int(parts[1])
                direction = parts[2]
                await inst.emit(
                    'gpio_setup',
                    {'pin': pin, 'direction': direction,
                     'pull': parts[3] if len(parts) > 3 else 'pud_off'},
                )
            except ValueError:
                pass
            return

        if op == 'GPIO_IN' and len(parts) == 2:
            try:
                pin = int(parts[1])
                await self._reply_gpio(inst, f'VAL {pin} 0')
            except ValueError:
                pass
            return

        if op in ('PWM_START', 'PWM_CHANGE') and len(parts) == 4:
            try:
                pin  = int(parts[1])
                freq = float(parts[2])
                duty = float(parts[3])
                await inst.emit('gpio_pwm',
                                {'pin': pin, 'frequency': freq,
                                 'duty_cycle': duty,
                                 'event': 'start' if op == 'PWM_START' else 'change'})
            except ValueError:
                pass
            return

        if op == 'PWM_STOP' and len(parts) == 2:
            try:
                pin = int(parts[1])
                await inst.emit('gpio_pwm',
                                {'pin': pin, 'event': 'stop'})
            except ValueError:
                pass
            return

        if op in ('I2C', 'SPI', 'UART'):
            disp = _PI_PROTOCOL_DISPATCHER
            if disp is not None:
                try:
                    reply = await disp(inst.client_id, parts)
                except Exception:
                    logger.exception('pi-protocol dispatcher crashed')
                    reply = None
                if reply is not None:
                    await self._reply_gpio(inst, reply)
                    return
            if op == 'I2C' and len(parts) >= 4:
                sub = parts[3]
                if sub in ('R', 'RR'):
                    await self._reply_gpio(
                        inst, f'I2C_ERR {parts[1]} {parts[2]} no-slave')
                return
            if op == 'SPI' and len(parts) >= 4 and parts[3] == 'X':
                try:
                    req_hex = parts[4] if len(parts) > 4 else ''
                    length = len(bytes.fromhex(req_hex))
                except ValueError:
                    length = 0
                await self._reply_gpio(
                    inst, f'SPI_DATA {parts[1]} {parts[2]} {"00" * length}')
                return
            if op == 'UART' and len(parts) >= 3 and parts[2] == 'RX_REQ':
                await self._reply_gpio(inst, f'UART_RX {parts[1]}')
            return

        logger.debug('pi-protocol: unhandled line: %r', line)

    async def _reply_gpio(self, inst: PiInstance, line: str) -> None:
        """Send a reply frame back to the guest over the second serial port."""
        if not inst._gpio_writer:
            return
        try:
            inst._gpio_writer.write((line + '\n').encode('ascii'))
            await inst._gpio_writer.drain()
        except OSError as e:
            logger.warning('%s protocol reply: %s', inst.client_id, e)

    async def _send_gpio(self, inst: PiInstance, pin: int,
                          state: bool) -> None:
        """Send an input pin change (SET <pin> <0|1>) to the guest."""
        if not inst._gpio_writer:
            return
        msg = f'SET {pin} {1 if state else 0}\n'.encode('ascii')
        try:
            inst._gpio_writer.write(msg)
            await inst._gpio_writer.drain()
        except OSError as e:
            logger.warning('%s protocol send: %s', inst.client_id, e)

    # ── QEMU stderr watcher ───────────────────────────────────────────────────

    async def _watch_stderr(self, inst: PiInstance) -> None:
        if not inst.process or not inst.process.stderr:
            return
        loop = asyncio.get_running_loop()
        try:
            while inst.running:
                line = await loop.run_in_executor(None, inst.process.stderr.readline)
                if not line:
                    break
                text = line.decode('utf-8', errors='replace').rstrip()
                if text:
                    logger.warning('QEMU[%s] %s', inst.client_id, text)
        except Exception:
            pass
        logger.info('QEMU[%s] process exited', inst.client_id)
        inst.running = False
        await inst.emit('system', {'event': 'exited'})

    # ── Shutdown ──────────────────────────────────────────────────────────────

    async def _shutdown(self, inst: PiInstance) -> None:
        inst.running = False

        for task in inst._tasks:
            task.cancel()
        inst._tasks.clear()

        if inst._gpio_writer:
            try:
                inst._gpio_writer.close()
            except Exception:
                pass
            inst._gpio_writer = None



        if inst._serial_writer:
            try:
                inst._serial_writer.close()
            except Exception:
                pass
            inst._serial_writer = None

        if inst.process:
            loop = asyncio.get_running_loop()
            try:
                inst.process.terminate()
                await asyncio.wait_for(
                    loop.run_in_executor(None, inst.process.wait),
                    timeout=5.0,
                )
            except Exception:
                try:
                    inst.process.kill()
                except Exception:
                    pass
            inst.process = None

        # Delete overlay
        if inst.overlay_path and os.path.exists(inst.overlay_path):
            try:
                os.unlink(inst.overlay_path)
            except Exception:
                pass
            inst.overlay_path = None

        # Notify pro overlay (if any) so it can drop its slave registry
        # entry for this client. OSS image has no handler → no-op.
        if _PI_SLAVE_HANDLER is not None:
            try:
                await _PI_SLAVE_HANDLER(inst.client_id, 'shutdown', {})
            except Exception:
                logger.exception('pi-slave shutdown hook crashed')

        logger.info('PiInstance %s shut down', inst.client_id)

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _get_provider(self) -> BootImageProvider:
        """Lazily resolve the boot-image provider on first boot.

        Building the provider eagerly at module import would try to
        read the env vars at import time, which races with .env loading
        in some entrypoints. Lazy resolution keeps that hazard local
        to the boot path.
        """
        if self._provider is None:
            self._provider = get_default_provider()
        return self._provider


# ── Lifespan pre-warm ────────────────────────────────────────────────────────
async def _prewarm_pi_boot_images() -> None:
    """Lifespan hook: download + cache the Pi virt boot files in the
    background at process start.

    Pre-warms every unique ``image_set`` referenced by PI_CONFIGS
    exactly once (Pi 3/4/5 share the arm64 set; Pi Zero/1/2 will add
    an armhf set in Phase 3.3). The cache check is cheap when files
    are already on disk (named docker volume), so this is a no-op
    for warm containers. Failures are logged but never block startup.
    """
    try:
        provider = get_default_provider()
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            '[pi] cannot build boot-image provider, skipping pre-warm: %s',
            exc,
        )
        return
    seen: set[str] = set()
    for cfg in PI_CONFIGS.values():
        if cfg['image_set'] in seen:
            continue
        seen.add(cfg['image_set'])
        asyncio.create_task(provider.warmup(cfg['image_set']))


register_lifespan_startup(_prewarm_pi_boot_images)


qemu_manager = QemuManager()
