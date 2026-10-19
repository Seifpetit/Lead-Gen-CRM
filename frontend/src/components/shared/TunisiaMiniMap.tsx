import type { RegionGeometry } from '@lead-gen-crm/shared';
import { useMemo } from 'react';
import { useT } from '../../i18n/index.js';
import { makeProjection, outlinePath, padBounds, unionBounds } from '../../lib/mapGeometry.js';

/**
 * Tunisia drawn from the committed governorate outlines (no tiles, no network): one region
 * highlighted and, when we know where the business is, a pin at its coordinates.
 */
export function TunisiaMiniMap({
  regions,
  regionId,
  pin,
}: {
  regions: readonly RegionGeometry[];
  /** The region to highlight. */
  regionId: string;
  pin: { lat: number; lng: number } | null;
}) {
  const t = useT();
  const drawable = regions.filter((r) => r.outline && r.bounds);
  const view = useMemo(() => {
    const all = unionBounds(drawable.map((r) => r.bounds!));
    return all ? makeProjection(padBounds(all, 0.04)) : null;
  }, [drawable.length]);
  if (!view) return null;
  const name = regions.find((r) => r.regionId === regionId)?.name ?? regionId;
  const label = pin
    ? t('location.mini.pin', { region: name })
    : t('location.mini.region', { region: name });
  return (
    <svg
      className="tunisia-mini"
      viewBox={`0 0 ${view.width} ${view.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
    >
      {drawable.map((r) => (
        <path
          key={r.regionId}
          d={outlinePath(r.outline!, view)}
          fillRule="evenodd"
          className={`mini-region${r.regionId === regionId ? ' is-picked' : ''}`}
          data-region={r.regionId}
        />
      ))}
      {pin && (
        <g className="mini-pin" transform={`translate(${view.x(pin.lng)} ${view.y(pin.lat)})`}>
          <circle r="9" className="mini-pin-halo" />
          <circle r="4.5" className="mini-pin-dot" />
        </g>
      )}
    </svg>
  );
}
