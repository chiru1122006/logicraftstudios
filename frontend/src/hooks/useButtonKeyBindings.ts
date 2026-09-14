/**
 * Global keyboard bridge for pushbuttons mapped to keys.
 *
 * keydown presses every button bound to that key, keyup releases it. The
 * bridge dispatches synthetic `button-press` / `button-release` events on
 * the component's wokwi element — the exact events its mouse interaction
 * fires — so every consumer (BasicParts pin logic, SPICE-driven inputs,
 * the QEMU GPIO bridge, the pressed visual) behaves identically to a
 * mouse click with zero per-simulator wiring.
 *
 * Guards:
 *   - ignored while typing in inputs / textareas / selects / Monaco
 *     (contentEditable) so mapped letters don't fire while editing code
 *   - ignored with Ctrl/Alt/Meta held (browser & app shortcuts win)
 *   - auto-repeat keydowns are ignored (a held key = one long press)
 *   - window blur releases everything (no stuck buttons after Alt-Tab)
 */

import { useEffect, useRef } from 'react';
import { buildKeyBindingMap, normalizeKey } from '../utils/keyButtonBindings';

interface BoundComponent {
  id: string;
  metadataId: string;
  properties: Record<string, unknown>;
}

function componentElement(componentId: string): Element | null {
  return (
    document.querySelector(
      `[data-component-id="${componentId}"] .web-component-container > *`,
    ) ?? null
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) {
    return true;
  }
  // Monaco's focus sink is a plain <div> (.native-edit-context with the
  // EditContext API, .inputarea textarea otherwise) — neither an input tag
  // nor contentEditable, so the checks above miss it. Treat any keydown
  // originating inside the editor widget as typing.
  return typeof el.closest === 'function' && el.closest('.monaco-editor') !== null;
}

export function useButtonKeyBindings(components: BoundComponent[]): void {
  // Rebuilt on every render pass where components changed; the listeners
  // read through the ref so they never go stale without re-binding.
  const bindingsRef = useRef<Map<string, string[]>>(new Map());
  bindingsRef.current = buildKeyBindingMap(components);

  // key → component ids currently held down via that key.
  const downRef = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    const dispatch = (componentId: string, type: 'button-press' | 'button-release') => {
      componentElement(componentId)?.dispatchEvent(new Event(type));
    };

    const releaseKey = (norm: string) => {
      const held = downRef.current.get(norm);
      if (!held) return;
      downRef.current.delete(norm);
      for (const id of held) dispatch(id, 'button-release');
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      if (isTypingTarget(e.target)) return;
      const norm = normalizeKey(e.key);
      const ids = bindingsRef.current.get(norm);
      if (!ids || ids.length === 0 || downRef.current.has(norm)) return;
      e.preventDefault();
      downRef.current.set(norm, [...ids]);
      for (const id of ids) dispatch(id, 'button-press');
    };

    const onKeyUp = (e: KeyboardEvent) => {
      releaseKey(normalizeKey(e.key));
    };

    const onBlur = () => {
      for (const norm of Array.from(downRef.current.keys())) releaseKey(norm);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      onBlur();
    };
  }, []);
}
