import type { Company, RegionGeometry } from '@lead-gen-crm/shared';
import { regionLabel } from '@lead-gen-crm/shared';
import { MapPin, SquareArrowOutUpRight } from 'lucide-react';
import { useApi } from '../../../api/context.js';
import { OsmMap } from '../../../components/shared/OsmMap.js';
import { DriveTime } from './DriveTime.js';
import { useT } from '../../../i18n/index.js';
import { useResource } from '../../../lib/useResource.js';

/** A Google Maps link for a point or a place: a plain link, so it needs no API key. */
export function googleMapsLink(
  company: Pick<Company, 'location' | 'googlePlaceId'>,
): string | null {
  if (!company.location) return null;
  const { lat, lng } = company.location;
  const params = new URLSearchParams({ api: '1', query: `${lat},${lng}` });
  if (company.googlePlaceId) params.set('query_place_id', company.googlePlaceId);
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

/**
 * Where the business is: an OpenStreetMap view of its whole region from above with a pin on the
 * business, the street address beside a link out to Google Maps, and a button that works out the
 * drive by car from the person's own address. Without coordinates the card says the exact place
 * is unknown.
 */
export function LocationCard({ company }: { company: Company }) {
  const t = useT();
  const api = useApi();
  const geometry = useResource(() => api.regions.geometry());
  const regions: readonly RegionGeometry[] = geometry.data?.items ?? [];
  const region = regions.find((r) => r.regionId === company.governorate);
  const regionName = region?.name ?? regionLabel(company.governorate);
  const where = company.location ?? null;
  const link = googleMapsLink(company);
  const bounds = region?.bounds ?? null;

  return (
    <section className="location-card" aria-label={t('location.title')}>
      <h3 className="location-title">
        <MapPin size={16} aria-hidden="true" /> {t('location.title')}
      </h3>
      {/* The region is the map's extent; a city says something more. */}
      {company.city && company.city !== regionName && (
        <p className="location-region">{`${company.city}, ${regionName}`}</p>
      )}
      {where ? (
        <>
          {/* Drawn once the region's box is known, so the map does not jump from one view to another. */}
          {geometry.loading ? (
            <div className="osm-map" aria-hidden="true" />
          ) : (
            <OsmMap
              lat={where.lat}
              lng={where.lng}
              bounds={bounds}
              zoom={10}
              label={company.name}
            />
          )}
          <p className="location-links">
            {link && (
              <a className="location-open" href={link} target="_blank" rel="noreferrer noopener">
                {t('location.openGoogle')}
                <SquareArrowOutUpRight size={12} aria-hidden="true" />
              </a>
            )}
            {company.address && (
              <span className="location-address">
                {t('location.address', { address: company.address })}
              </span>
            )}
          </p>
          <DriveTime to={where} />
        </>
      ) : (
        <>
          {company.address && (
            <p className="location-address">
              {t('location.address', { address: company.address })}
            </p>
          )}
          <p className="muted location-unknown">{t('location.unknown')}</p>
        </>
      )}
    </section>
  );
}
