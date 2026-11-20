import type { Area } from './windowState';

export function trayPanelBounds(anchor: Area, workArea: Area, size = { width: 440, height: 600 }): Area {
  const gap = 8;
  const width = Math.min(size.width, Math.max(1, workArea.width - gap * 2));
  const height = Math.min(size.height, Math.max(1, workArea.height - gap * 2));
  const clamp = (value: number, start: number, length: number, extent: number) =>
    Math.round(Math.max(start + gap, Math.min(value, start + length - extent - gap)));
  const below = anchor.y + anchor.height / 2 < workArea.y + workArea.height / 2;
  return {
    x: clamp(anchor.x + anchor.width / 2 - width / 2, workArea.x, workArea.width, width),
    y: clamp(below ? anchor.y + anchor.height + gap : anchor.y - height - gap, workArea.y, workArea.height, height),
    width,
    height,
  };
}
