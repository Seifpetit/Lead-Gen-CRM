import { createDb } from '../data/db.js';
import { setRegionBounds } from '../data/regions.js';

// Manual fix for one region's search area, kept across re-seeds:
//   npm run regions:set-bounds -- <regionId> <south> <west> <north> <east>
const [regionId, ...nums] = process.argv.slice(2);
const [south, west, north, east] = nums.map(Number);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is missing');
  process.exit(1);
}
if (
  !regionId ||
  nums.length !== 4 ||
  [south, west, north, east].some((n) => !Number.isFinite(n)) ||
  !(north! > south! && east! > west!) ||
  Math.abs(south!) > 90 ||
  Math.abs(north!) > 90 ||
  Math.abs(west!) > 180 ||
  Math.abs(east!) > 180
) {
  console.error(
    'usage: regions:set-bounds <regionId> <south> <west> <north> <east>  (north > south, east > west)',
  );
  process.exit(1);
}

const db = createDb(url);
try {
  await setRegionBounds(db, regionId, { south: south!, west: west!, north: north!, east: east! });
  console.log(`bounds set for ${regionId}: ${south} ${west} ${north} ${east}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await db.end();
}
