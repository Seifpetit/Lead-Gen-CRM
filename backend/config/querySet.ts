/**
 * Which set of search terms is current. Coverage (what was searched, what ran dry) only means
 * something for the terms that produced it, so searches carry this number and coverage readers
 * count only the current set. Change it together with a migration that archives the old
 * coverage (see 016_import_export). 1 = domestic-transport terms, 2 = import/export terms.
 */
export const QUERY_SET = 2;
