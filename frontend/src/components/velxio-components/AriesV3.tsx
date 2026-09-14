import React from 'react';
import './AriesV3Element';

type AriesIntrinsic = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'velxio-aries-v3': AriesIntrinsic;
    }
  }
}

interface AriesV3Props {
  id: string;
  x: number;
  y: number;
  heartbeat?: boolean;
  rgb?: string;
}

/** React wrapper for the C-DAC ARIES v3.0 RISC-V board Web Component. */
export const AriesV3 = ({ id, x, y, heartbeat = false, rgb = '' }: AriesV3Props) => {
  const ref = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    if (ref.current) {
      (ref.current as any).heartbeat = heartbeat;
    }
  }, [heartbeat]);

  React.useEffect(() => {
    if (ref.current) {
      (ref.current as any).rgb = rgb;
    }
  }, [rgb]);

  return (
    <velxio-aries-v3
      id={id}
      ref={ref}
      style={{ position: 'absolute', left: x, top: y }}
    />
  );
};
