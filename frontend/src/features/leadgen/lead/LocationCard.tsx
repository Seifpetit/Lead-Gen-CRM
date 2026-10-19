import type { Company, RegionGeometry } from '@lead-gen-crm/shared';
import { regionLabel } from '@lead-gen-crm/shared';
import { MapPin, SquareArrowOutUpRight } from 'lucide-react';
import { useApi } from '../../../api/context.js';
import { OsmMap } from '../../../components/shared/OsmMap.js';
import { TunisiaMiniMap } from '../../../components/shared/TunisiaMiniMap.js';
import { useT } from '../../../i18n/index.js';
import { useResource } from '../../../lib/useResource.js';
import { ExternalLink } from '../../../components/shared/ExternalLink.js';

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
 * Where the business is: Tunisia with its region lit and a pin, then an OpenStreetMap close-up
 * with a link out to Google Maps. Without coordinates the region is lit and the card says the
 * exact place is unknown.
 */
export function LocationCard({ company }: { company: Company }) {
  const t = useT();
  const api = useApi();
  const geometry = useResource(() => api.regions.geometry());
  const regions: readonly RegionGeometry[] = geometry.data?.items ?? [];
  const regionName =
    regions.find((r) => r.regionId === company.governorate)?.name ??
    regionLabel(company.governorate);
  const where = company.location ?? null;
  const link = googleMapsLink(company);

  return (
    <section className="location-card" aria-label={t('location.title')}>
      <h3 className="location-title">
        <MapPin size={16} aria-hidden="true" /> {t('location.title')}
      </h3>
      {/* The region itself is on the map and in the Region row; a city says something more. */}
      {company.city && company.city !== regionName && (
        <p className="location-region">{`${company.city}, ${regionName}`}</p>
      )}
      {regions.length > 0 && (
        <TunisiaMiniMap regions={regions} regionId={company.governorate} pin={where} />
      )}
      {where ? (
        <>
          <OsmMap lat={where.lat} lng={where.lng} label={company.name} />
          {link && (
            <ExternalLink kind="maps" name={company.name} className="location-open" href={link}>
              {t('location.openGoogle')}
              <SquareArrowOutUpRight size={12} aria-hidden="true" />
            </ExternalLink>
          )}
        </>
      ) : (
        <p className="muted location-unknown">{t('location.unknown')}</p>
      )}
      {/*
        FUTURE: a "distance from my address" line goes here. Coordinates are stored as lat/lng
        numbers on the company and `haversineKm` (backend/lib/geo.ts) is ready; not built yet.
      */}
    </section>
  );
}
