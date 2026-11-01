import type { CountryCode } from '@lead-gen-crm/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.js';

/**
 * Makes everything inside ask the server about one country, whatever the sidebar says, and puts
 * the old choice back when it goes away. The Coverage map uses it so "Start a run" in a French
 * region lists French regions while the rest of the app stays on its own country.
 */
export function ScopeOverride({
  country,
  children,
}: {
  country: CountryCode;
  children: ReactNode;
}) {
  const api = useApi();
  const [before] = useState(() => api.scope.country);
  // Set while drawing: the children ask the server in their own effects, which run before ours.
  api.scope.country = country;
  useEffect(() => {
    api.scope.country = country;
    return () => {
      api.scope.country = before;
    };
  }, [api, country, before]);
  return children;
}
