import type { CountryCode } from '@lead-gen-crm/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApi } from '../../api/context.js';
import { useToast } from '../../components/shared/Toast.js';
import { ErrorState } from '../../components/states.js';
import { useT } from '../../i18n/index.js';
import { isExplored } from '../../lib/coverageView.js';
import { useResource } from '../../lib/useResource.js';
import { GdprDialog, gdprAccepted } from '../country/GdprNotice.js';
import { CountryPicker } from '../country/CountrySwitch.js';
import { ScopeOverride } from '../country/ScopeOverride.js';
import { CreateRunModal } from './CreateRunModal.js';
import { startedMessage } from './startrun/startPlan.js';
import { PinPanel } from './worldmap/PinPanel.js';
import { RegionPanel } from './worldmap/RegionPanel.js';
import { WorldMap } from './worldmap/WorldMap.js';
import { PIN_COLORS } from './worldmap/worldStyle.js';
import { countryTotals, pinsPerRegion, sortRegions, toneMap } from './worldmap/worldView.js';

const NO_PINS: never[] = [];
const NO_REGIONS: never[] = [];
const LEGEND = ['exporter', 'importer', 'both', 'trader'] as const;

/**
 * Coverage is a big map of the world. Every company the app has found is a pin; the countries the
 * app works in are light grey, the rest dark grey and empty. Picking a country (in the picker or
 * by clicking it) moves the camera there, shows its regions and opens "Coverage by region". The
 * pick lives in the address (?focus=FR&region=bretagne) so refresh and Back work.
 */
export function CoveragePage() {
  const t = useT();
  const api = useApi();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);
  const [hoverRegion, setHoverRegion] = useState<string | null>(null);
  const [openPinId, setOpenPinId] = useState<string | null>(null);
  const [planning, setPlanning] = useState<string | null>(null);
  // The data-protection notice comes before the first run in a European country, as elsewhere.
  const [noticeFor, setNoticeFor] = useState<string | null>(null);
  const [toggled, setToggled] = useState<{ focus: CountryCode | null; open: boolean } | null>(null);

  const countriesRes = useResource(() => api.countries.list());
  const pinsRes = useResource(() => api.map.pins({ country: 'ALL' }), { deps: [refreshKey] });
  const summariesRes = useResource(() => api.regions.all({ country: 'ALL' }), {
    deps: [refreshKey],
  });

  const countries = useMemo(() => countriesRes.data?.items ?? [], [countriesRes.data]);
  const supported = useMemo(
    () => countries.filter((c) => c.enabled).map((c) => c.code),
    [countries],
  );
  const pins = pinsRes.data?.items ?? NO_PINS;
  const allSummaries = useMemo(() => summariesRes.data ?? [], [summariesRes.data]);

  // The address says which country the camera is on; one that is unknown or switched off counts as none.
  const wantedFocus = params.get('focus');
  const focus = supported.find((c) => c === wantedFocus) ?? null;
  const info = countries.find((c) => c.code === focus) ?? null;

  const geometry = useResource(() => api.regions.geometry({ country: focus! }), {
    enabled: focus !== null,
    deps: [focus, refreshKey],
  });
  const regionShapes = useMemo(
    () =>
      focus ? (geometry.data?.items.filter((r) => r.country === focus) ?? NO_REGIONS) : NO_REGIONS,
    [focus, geometry.data],
  );
  const summaries = useMemo(
    () => (focus ? sortRegions(allSummaries.filter((r) => r.country === focus)) : []),
    [focus, allSummaries],
  );
  const tones = useMemo(() => toneMap(summaries), [summaries]);
  const totals = useMemo(
    () => countryTotals(countries, allSummaries, pins),
    [countries, allSummaries, pins],
  );
  const pinCounts = useMemo(() => pinsPerRegion(pins), [pins]);

  const wantedRegion = params.get('region');
  const region = summaries.find((r) => r.regionId === wantedRegion && isExplored(r)) ?? null;
  const regionId = region?.regionId ?? null;

  const pin = pins.find((p) => p.companyId === openPinId) ?? null;
  const regionNames = useMemo(
    () => new Map(allSummaries.map((r) => [r.regionId, r.name])),
    [allSummaries],
  );

  // "Coverage by region" opens by itself when a country is picked; a click toggles it from there.
  const open = toggled !== null && toggled.focus === focus ? toggled.open : focus !== null;

  const go = useCallback(
    (country: CountryCode | null, regionOf: string | null = null) => {
      const next = new URLSearchParams();
      if (country !== null) next.set('focus', country);
      if (country !== null && regionOf !== null) next.set('region', regionOf);
      setParams(next);
    },
    [setParams],
  );
  const pickCountry = useCallback(
    (country: CountryCode | null) => {
      setOpenPinId(null);
      setHoverRegion(null);
      go(country);
    },
    [go],
  );

  // Escape steps back: the open pin, then the picked region, then the picked country. The
  // listener reads the latest state from a ref, so two quick presses never see the old pick.
  const stepBack = useRef(() => {});
  stepBack.current = () => {
    if (openPinId !== null) setOpenPinId(null);
    else if (regionId !== null) go(focus);
    else if (focus !== null) pickCountry(null);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[aria-modal="true"]')) return;
      stepBack.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const failure = countriesRes.error ?? pinsRes.error ?? summariesRes.error;
  const failed = failure !== null && (!countriesRes.data || !pinsRes.data || !summariesRes.data);
  const retry = () => {
    countriesRes.reload();
    pinsRes.reload();
    summariesRes.reload();
  };
  const cut = pinsRes.data && pinsRes.data.total > pinsRes.data.items.length;
  const countryOf = (id: string) =>
    countries.find((c) => c.code === allSummaries.find((r) => r.regionId === id)?.country);
  const noticeCountry = noticeFor ? countryOf(noticeFor) : undefined;
  const planningCountry = planning
    ? allSummaries.find((r) => r.regionId === planning)?.country
    : undefined;

  return (
    <main id="main" className="page dash-page">
      <div className="dash-panel wm-panel">
        <h1 className="visually-hidden">{t('side.coverage')}</h1>
        <WorldMap
          supported={supported}
          country={focus}
          regions={regionShapes}
          tones={tones}
          hoverRegion={hoverRegion}
          selectedRegion={regionId}
          pins={pins}
          openPinId={pin?.companyId ?? null}
          onCountry={(code) => code !== focus && pickCountry(code)}
          onBackground={() => {
            setOpenPinId(null);
            if (regionId !== null) go(focus);
          }}
          onRegionHover={setHoverRegion}
          onRegionClick={(id) => {
            const row = summaries.find((r) => r.regionId === id);
            if (focus && row && isExplored(row)) go(focus, id === regionId ? null : id);
          }}
          onPinClick={(p) => setOpenPinId(p.companyId)}
          pinPanel={(at, size) =>
            pin && at ? (
              <PinPanel
                pin={pin}
                at={at}
                size={size}
                regionName={regionNames.get(pin.regionId) ?? null}
                onClose={() => setOpenPinId(null)}
              />
            ) : null
          }
        >
          <div className="wm-float wm-float-tl">
            <CountryPicker
              className="wm-picker"
              choice={focus ?? 'ALL'}
              countries={countries}
              allowsAll
              onChoose={(choice) => pickCountry(choice === 'ALL' ? null : choice)}
            />
          </div>

          {failed ? (
            <div className="wm-float wm-float-top">
              <ErrorState error={failure} onRetry={retry} />
            </div>
          ) : (
            pinsRes.data &&
            pins.length === 0 && (
              <p className="wm-float wm-float-top wm-notice" role="status">
                {t('wm.empty')}
              </p>
            )
          )}

          <div className="wm-float wm-float-bl">
            <RegionPanel
              open={open}
              onToggle={() => setToggled({ focus, open: !open })}
              country={info}
              totals={totals}
              summaries={summaries}
              pinCounts={pinCounts}
              hover={hoverRegion}
              onHover={setHoverRegion}
              selected={regionId}
              onSelect={(id) => go(focus, id)}
              onPickCountry={pickCountry}
              onStart={(id) => {
                if (countryOf(id)?.gdprNotice && !gdprAccepted()) setNoticeFor(id);
                else setPlanning(id);
              }}
            />
          </div>

          <div className="wm-float wm-float-br">
            <ul className="wm-legend" aria-label={t('wm.legend')}>
              {LEGEND.map((role) => (
                <li key={role}>
                  <span
                    className="wm-swatch"
                    style={{ background: PIN_COLORS[role] }}
                    aria-hidden="true"
                  />
                  {t(`trade.role.${role}`)}
                </li>
              ))}
            </ul>
            <p className="wm-credits">
              {cut && pinsRes.data
                ? `${t('wm.cut', { shown: pinsRes.data.items.length, total: pinsRes.data.total })} `
                : ''}
              {t('wm.credit.world')}
              {focus ? ` ${t(`map.attribution.${focus}`)}` : ''}
            </p>
          </div>
        </WorldMap>
      </div>

      {noticeFor && noticeCountry && (
        <GdprDialog
          info={noticeCountry}
          onClose={() => {
            setPlanning(noticeFor);
            setNoticeFor(null);
          }}
        />
      )}
      {planning && planningCountry && (
        <ScopeOverride country={planningCountry}>
          <CreateRunModal
            regionId={planning}
            onCreated={(runs, notStarted) => {
              setPlanning(null);
              toast.show(startedMessage(t, runs, notStarted));
              setRefreshKey((n) => n + 1);
            }}
            onCancel={() => setPlanning(null)}
          />
        </ScopeOverride>
      )}
    </main>
  );
}
