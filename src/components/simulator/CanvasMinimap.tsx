/**
 * CanvasMinimap — bottom-right corner overview of the whole canvas with a
 * draggable viewport rectangle.
 *
 * Geometry mirrors the canvas:
 *   .canvas-world is 4000×3000 px in world space.
 *   .canvas-content is the viewport, sized to the available area at runtime.
 *   .canvas-world's transform is `translate(pan.x, pan.y) scale(zoom)`.
 *
 * The minimap is MINIMAP_W × MINIMAP_H (same 4:3 aspect as the world, so
 * SCALE_X === SCALE_Y). A world point (wx, wy) renders at (wx*SCALE, wy*SCALE).
 *
 * The viewport rectangle shows what fraction of the world is visible:
 *   rect.x = -pan.x / zoom * SCALE
 *   rect.y = -pan.y / zoom * SCALE
 *   rect.w = viewport.width  / zoom * SCALE
 *   rect.h = viewport.height / zoom * SCALE
 *
 * LIVE TRACKING: while the user pans/zooms, SimulatorCanvas deliberately
 * bypasses React state — it writes panRef/zoomRef and mutates the
 * .canvas-world transform directly for zero-lag dragging, committing to
 * state only on pointer-up. The minimap therefore CANNOT rely on the pan
 * prop alone (the red rectangle would freeze mid-drag — reported bug). It
 * reads panRef/zoomRef inside a requestAnimationFrame loop and updates its
 * own tiny local state only when the values actually change: the canvas
 * stays render-free during the gesture, and only this small component
 * re-renders, at most once per frame.
 *
 * Interaction:
 *   - Pointer down OUTSIDE the rectangle → teleport: center the viewport
 *     on the clicked world point.
 *   - Pointer down INSIDE the rectangle → drag mode: live-pan the canvas.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Component } from '../../types/components';
import type { BoardInstance } from '../../types/board';
import { BOARD_SIZE } from './BoardOnCanvas';
import './CanvasMinimap.css';

const MINIMAP_W = 160;
const MINIMAP_H = 120;
const WORLD_W = 4000;
const WORLD_H = 3000;
const SCALE_X = MINIMAP_W / WORLD_W;
const SCALE_Y = MINIMAP_H / WORLD_H;
// Fallback footprint for boards missing from the BOARD_SIZE table.
const BOARD_FALLBACK = { w: 300, h: 200 };

interface Props {
  pan: { x: number; y: number };
  zoom: number;
  setPan: (p: { x: number; y: number }) => void;
  /** Live pan/zoom refs from SimulatorCanvas. During a canvas drag these are
   *  the ONLY up-to-date source — React state lags until pointer-up. */
  panRef: React.MutableRefObject<{ x: number; y: number }>;
  zoomRef: React.MutableRefObject<number>;
  components: Component[];
  boards: BoardInstance[];
  /** Ref to the .canvas-content element — we read its size to compute the
   *  viewport rectangle, since the canvas viewport changes when the user
   *  resizes their window or toggles a sidebar. */
  viewportRef: React.RefObject<HTMLElement>;
}

export const CanvasMinimap: React.FC<Props> = ({
  pan,
  zoom,
  setPan,
  panRef,
  zoomRef,
  components,
  boards,
  viewportRef,
}) => {
  // Live pan/zoom mirrored from the refs via rAF (see header comment).
  const [live, setLive] = useState({ x: pan.x, y: pan.y, zoom });
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const p = panRef.current;
      const z = zoomRef.current;
      setLive((cur) =>
        cur.x === p.x && cur.y === p.y && cur.zoom === z ? cur : { x: p.x, y: p.y, zoom: z },
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [panRef, zoomRef]);

  // Visible viewport size in CSS pixels — listens for resize so the
  // rectangle stays accurate when the user opens / closes side panels.
  const [vp, setVp] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setVp({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewportRef]);

  // The viewport rectangle in minimap coordinates (from LIVE values).
  const rectX = (-live.x / live.zoom) * SCALE_X;
  const rectY = (-live.y / live.zoom) * SCALE_Y;
  const rectW = (vp.w / live.zoom) * SCALE_X;
  const rectH = (vp.h / live.zoom) * SCALE_Y;

  // Clamp the rectangle to the minimap bounds so it never paints outside
  // (transiently during pinch-zoom-out, and persistently when the user
  // pans past a world edge).  We hit-test against these clamped values
  // too — otherwise clicking the visible red rect can fall outside the
  // unclamped logical rect and erroneously trigger a teleport instead
  // of a drag.
  const clampedW = Math.min(rectW, MINIMAP_W);
  const clampedH = Math.min(rectH, MINIMAP_H);
  const clampedX = Math.max(0, Math.min(MINIMAP_W - clampedW, rectX));
  const clampedY = Math.max(0, Math.min(MINIMAP_H - clampedH, rectY));

  // Drag state. We use a ref + window listeners (rather than React's
  // onMouseMove on the minimap div) so the gesture keeps working even if
  // the cursor leaves the minimap during a fast pan.
  const dragRef = useRef<
    | {
        // Mouse position at mousedown.
        mouseX: number;
        mouseY: number;
        // Pan at mousedown — we add (delta-converted-to-world) to this.
        panX: number;
        panY: number;
      }
    | null
  >(null);

  const minimapRef = useRef<HTMLDivElement>(null);

  // Clamp pan so the viewport rectangle never escapes the minimap. World
  // is 4000×3000; minimum visible is whatever fits at the current zoom.
  const clampPan = useCallback(
    (next: { x: number; y: number }): { x: number; y: number } => {
      const z = zoomRef.current;
      // Visible-area limits expressed in pan-space:
      //   pan.x = 0          → world x=0 at left edge of viewport.
      //   pan.x = -(WORLD_W*zoom - vp.w) → world right edge at right of viewport.
      const minX = -(WORLD_W * z - vp.w);
      const minY = -(WORLD_H * z - vp.h);
      return {
        x: Math.min(0, Math.max(minX, next.x)),
        y: Math.min(0, Math.max(minY, next.y)),
      };
    },
    [zoomRef, vp.w, vp.h],
  );

  const teleportTo = useCallback(
    (worldX: number, worldY: number) => {
      const z = zoomRef.current;
      // Center the viewport on (worldX, worldY).
      setPan(
        clampPan({
          x: -worldX * z + vp.w / 2,
          y: -worldY * z + vp.h / 2,
        }),
      );
    },
    [zoomRef, vp.w, vp.h, setPan, clampPan],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const minimap = minimapRef.current;
      if (!minimap) return;
      const rect = minimap.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const insideRect =
        localX >= clampedX &&
        localX <= clampedX + clampedW &&
        localY >= clampedY &&
        localY <= clampedY + clampedH;
      if (insideRect) {
        // Drag mode — record start state, window listeners do the rest.
        dragRef.current = {
          mouseX: e.clientX,
          mouseY: e.clientY,
          panX: panRef.current.x,
          panY: panRef.current.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      } else {
        // Teleport — convert minimap-local click to world coords.
        teleportTo(localX / SCALE_X, localY / SCALE_Y);
      }
    },
    [clampedX, clampedY, clampedW, clampedH, panRef, teleportTo],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.mouseX;
      const dy = e.clientY - drag.mouseY;
      // (delta in minimap px) / SCALE = (delta in world units, unscaled).
      // (delta in world units) * zoom = (delta to add to pan, but inverted).
      const z = zoomRef.current;
      setPan(
        clampPan({
          x: drag.panX - (dx / SCALE_X) * z,
          y: drag.panY - (dy / SCALE_Y) * z,
        }),
      );
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [zoomRef, setPan, clampPan]);

  return (
    <div
      ref={minimapRef}
      className="canvas-minimap"
      onPointerDown={onPointerDown}
      style={{ width: MINIMAP_W, height: MINIMAP_H }}
      aria-label="Canvas minimap"
    >
      <div className="canvas-minimap-world">
        {boards.map((b) => {
          const size = BOARD_SIZE[b.boardKind] ?? BOARD_FALLBACK;
          return (
            <div
              key={b.id}
              className="canvas-minimap-board"
              style={{
                left: b.x * SCALE_X,
                top: b.y * SCALE_Y,
                width: Math.max(2, size.w * SCALE_X),
                height: Math.max(2, size.h * SCALE_Y),
              }}
            />
          );
        })}
        {components.map((c) => (
          <div
            key={c.id}
            className="canvas-minimap-component"
            style={{
              left: c.x * SCALE_X,
              top: c.y * SCALE_Y,
            }}
          />
        ))}
      </div>
      <div
        className="canvas-minimap-viewport"
        style={{
          left: clampedX,
          top: clampedY,
          width: clampedW,
          height: clampedH,
        }}
      />
    </div>
  );
};
