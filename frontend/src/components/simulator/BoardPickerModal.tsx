import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { BoardKind } from '../../types/board';
import { BOARD_KIND_LABELS } from '../../types/board';

/** Neutral chip glyph for overlay-registered boards without a bespoke icon. */
const PRO_FALLBACK_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="3" y="3" width="10" height="10" rx="2" fill="#8b5cf6" />
    <rect x="5.5" y="5.5" width="5" height="5" rx="1" fill="#1e1b2e" />
  </svg>
);


const BOARD_DESCRIPTIONS: Record<BoardKind, string> = {
  'arduino-uno': '8-bit AVR, 32KB flash, 14 digital I/O',
  'arduino-nano': 'Compact 8-bit AVR, same as Uno',
  'arduino-mega': '8-bit AVR, 256KB flash, 54 digital I/O',
  'raspberry-pi-pico': 'RP2040 dual-core Cortex-M0+',
  'raspberry-pi-3': 'ARM64 Cortex-A53 quad-core, Linux/Python (QEMU)',
  'raspberry-pi-4': 'ARM64 Cortex-A72 quad-core, Linux/Python (QEMU)',
  'raspberry-pi-5': 'ARM64 Cortex-A76 quad-core + RP1 I/O, Linux/Python (QEMU)',
  esp32: 'Xtensa LX6 dual-core, WiFi+BT, 38 GPIO (QEMU)',
  'esp32-s3': 'Xtensa LX7 dual-core, WiFi+BT, AI accel (QEMU)',
  'esp32-c3': 'RISC-V single-core, WiFi+BLE, 22 GPIO (QEMU)',
  'stm32-bluepill': 'STM32F103C8 Cortex-M3, 64KB flash, 37 GPIO (QEMU)',
  'stm32-blackpill': 'STM32F411CE Cortex-M4, 512KB flash, 50 GPIO (QEMU)',
  'aries-v3': 'C-DAC VEGA THEJAS32 RISC-V SoC, 100MHz, 256KB SRAM, 32 GPIO (Added: 11-09-2026)',
};

const BOARD_ICON: Record<BoardKind, string> = {
  'arduino-uno': '⬤',
  'arduino-nano': '▪',
  'arduino-mega': '▬',
  'raspberry-pi-pico': '◆',
  'raspberry-pi-3': '⬛',
  'raspberry-pi-4': '⬛',
  'raspberry-pi-5': '⬛',
  esp32: '⬡',
  'esp32-s3': '⬡',
  'esp32-c3': '⬡',
  'stm32-bluepill': '◈',
  'stm32-blackpill': '◈',
  'aries-v3': '◆',
};

interface BoardPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectBoard: (kind: BoardKind) => void;
}

const BOARDS: BoardKind[] = [
  'arduino-uno',
  'arduino-nano',
  'arduino-mega',
  'raspberry-pi-pico',
  'raspberry-pi-3',
  'raspberry-pi-4',
  'raspberry-pi-5',
  'esp32',
  'esp32-s3',
  'esp32-c3',
  'stm32-bluepill',
  'stm32-blackpill',
  'aries-v3',
];

export const BoardPickerModal = ({ isOpen, onClose, onSelectBoard }: BoardPickerModalProps) => {
  const { t } = useTranslation();
  if (!isOpen) return null;

  // Portal to <body>: escape the canvas subtree so no ancestor stacking
  // context can pin the dialog below floating panels (e.g. the AI chat).
  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.78)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0c0c11',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 16,
          padding: '22px 24px',
          minWidth: 400,
          maxWidth: 520,
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 28px 80px rgba(0, 0, 0, 0.95)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ color: '#ffffff', margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.2px' }}>
            {t('editor.boardPicker.title')}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--wb-10)',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: '4px 6px',
              borderRadius: 6,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#ffffff';
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--wb-10)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', paddingRight: 2 }}>
          {BOARDS.map((kind) => (
            <button
              key={kind}
              onClick={() => {
                onSelectBoard(kind);
                onClose();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '11px 14px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 10,
                cursor: 'pointer',
                color: 'var(--wb-12)',
                textAlign: 'left',
                transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)';
                e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.4)';
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.5)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <span
                style={{
                  fontSize: 20,
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  flexShrink: 0,
                  color: kind.startsWith('raspberry')
                    ? '#f87171'
                    : kind.startsWith('esp')
                      ? '#fbbf24'
                      : kind === 'aries-v3'
                        ? '#38bdf8'
                        : '#60a5fa',
                }}
              >
                {BOARD_ICON[kind] ?? PRO_FALLBACK_ICON}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5, color: '#ffffff' }}>{BOARD_KIND_LABELS[kind]}</span>
                  {kind === 'aries-v3' && (
                    <span
                      style={{
                        fontSize: 9.5,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: '#34d399',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        fontWeight: 600,
                        letterSpacing: '0.2px',
                      }}
                    >
                      Added: 11-09-2026
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--wb-10)', marginTop: 2, lineHeight: 1.3 }}>
                  {BOARD_DESCRIPTIONS[kind]}
                </div>
              </div>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{
              padding: '7px 16px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 8,
              color: 'var(--wb-11)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#ffffff';
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.09)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--wb-11)';
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
