import { describe, expect, it } from 'vitest';
import { getCompany } from './companies.js';
import type { Db } from './db.js';
import { listLeads } from './crmLeads.js';
import { listRuns } from './runs.js';

// Compile-time guarantees: `npm run typecheck` fails if any @ts-expect-error below stops
// being an error, i.e. if a user-owned query becomes callable without a UserId.
describe('user scoping', () => {
  it('user-owned queries require a UserId, not a plain string', () => {
    const db = {} as Db;
    const typeChecks = () => {
      // @ts-expect-error missing user ID
      void listRuns(db);
      // @ts-expect-error a raw string is not a UserId
      void listLeads(db, 'some-user-id');
      // @ts-expect-error a raw string is not a UserId
      void getCompany(db, 'some-user-id', 'company-id');
    };
    expect(typeChecks).toBeTypeOf('function');
  });
});
