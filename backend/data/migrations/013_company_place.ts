import type { Migration } from '../migrate.js';

export const migration: Migration = {
  id: '013_company_place',
  up: /* sql */ `
    -- Where a business is and what Google calls it, kept on the company so cards and the
    -- detail page can show a city, a category and a pin. Coordinates are plain numbers.
    ALTER TABLE companies
      ADD COLUMN lat double precision,
      ADD COLUMN lng double precision,
      ADD COLUMN category text,
      ADD COLUMN address text,
      ADD CONSTRAINT companies_location_pair CHECK ((lat IS NULL) = (lng IS NULL)),
      ADD CONSTRAINT companies_lat_range CHECK (lat BETWEEN -90 AND 90),
      ADD CONSTRAINT companies_lng_range CHECK (lng BETWEEN -180 AND 180);

    -- Companies found before this migration: the first search result already holds the place.
    UPDATE companies c SET
        lat = p.lat, lng = p.lng,
        category = coalesce(c.category, p.category),
        address = coalesce(c.address, p.address)
      FROM (
        SELECT DISTINCT ON (rc.company_id) rc.company_id,
               CASE WHEN jsonb_typeof(rc.payload #> '{place,location,lat}') = 'number'
                     AND jsonb_typeof(rc.payload #> '{place,location,lng}') = 'number'
                    THEN (rc.payload #>> '{place,location,lat}')::double precision END AS lat,
               CASE WHEN jsonb_typeof(rc.payload #> '{place,location,lat}') = 'number'
                     AND jsonb_typeof(rc.payload #> '{place,location,lng}') = 'number'
                    THEN (rc.payload #>> '{place,location,lng}')::double precision END AS lng,
               nullif(rc.payload #>> '{place,category,value}', '') AS category,
               nullif(rc.payload #>> '{place,address,value}', '') AS address
          FROM run_companies rc
         WHERE rc.payload ? 'place'
         ORDER BY rc.company_id, rc.is_new DESC, rc.updated_at
      ) p
     WHERE c.id = p.company_id
       AND (p.lat BETWEEN -90 AND 90) AND (p.lng BETWEEN -180 AND 180);
  `,
  down: /* sql */ `
    ALTER TABLE companies
      DROP CONSTRAINT companies_lng_range,
      DROP CONSTRAINT companies_lat_range,
      DROP CONSTRAINT companies_location_pair,
      DROP COLUMN address,
      DROP COLUMN category,
      DROP COLUMN lng,
      DROP COLUMN lat;
  `,
};
