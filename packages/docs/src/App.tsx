import { useCallback, useEffect, useMemo, useState } from 'react';
import { CustomDataPanel } from './components/CustomDataPanel';
import { DatasetPicker } from './components/DatasetPicker';
import { Hero } from './components/Hero';
import { Reference } from './components/Reference';
import { ResultsColumn } from './components/ResultsColumn';
import { SearchInput } from './components/SearchInput';
import { type DatasetConfig, datasets, discoverStringPaths, type SelectableDataset } from './data';
import {
  clearFuseCache,
  clearFuzzysortCache,
  clearLunrCache,
  clearMiniSearchCache,
  type SearchResult,
  searchFuse,
  searchFuzzysort,
  searchLunr,
  searchMiniSearch,
  searchSeaq,
  searchSeaqV1,
  searchUFuzzy,
} from './engines';

export type EngineKey = 'seaq' | 'seaqv1' | 'fuzzysort' | 'fuse' | 'minisearch' | 'ufuzzy' | 'lunr';

/** Shown when "Your JSON" is selected but nothing has been loaded yet. */
const emptyCustomDataset: DatasetConfig = {
  label: 'Your JSON',
  data: [],
  keys: [],
  displayFn: (item) => String(item),
};

export interface SeaqConfig {
  fuzziness: number;
  fieldMode: 'joined' | 'separate';
  limit: number | undefined;
  threshold: number;
  /** 'auto' = the library default (index from the second search). */
  cache: 'auto' | boolean;
}

export interface SeaqV1Config {
  fuzziness: number;
}

export interface FuseConfig {
  threshold: number;
  distance: number;
  ignoreLocation: boolean;
  minMatchCharLength: number;
  isCaseSensitive: boolean;
  preIndexed: boolean;
}

export interface FuzzysortConfig {
  threshold: number;
  limit: number;
  preIndexed: boolean;
}

export interface MiniSearchConfig {
  fuzzy: number;
  prefix: boolean;
  combineWith: 'OR' | 'AND';
  fuzzyWeight: number;
  prefixWeight: number;
  preIndexed: boolean;
}

export interface UFuzzyConfig {
  intraMode: 0 | 1;
  intraSub: 0 | 1;
  intraTrn: 0 | 1;
  intraDel: 0 | 1;
}

export interface LunrConfig {
  preIndexed: boolean;
  wildcard: boolean;
  editDistance: number;
}

/** Maps dot-path keys that traverse arrays to their array/inner path segments. */
export type ArrayKeyMap = Record<string, { arrayPath: string; innerPath: string }>;

export interface EngineConfigs {
  seaq: SeaqConfig;
  seaqv1: SeaqV1Config;
  fuzzysort: FuzzysortConfig;
  fuse: FuseConfig;
  minisearch: MiniSearchConfig;
  ufuzzy: UFuzzyConfig;
  lunr: LunrConfig;
}

export const defaultConfigs: EngineConfigs = {
  seaq: { fuzziness: 0.2, fieldMode: 'joined', limit: 10, threshold: 0.3, cache: 'auto' },
  seaqv1: { fuzziness: 0.2 },
  fuzzysort: { threshold: 0.5, limit: 10, preIndexed: true },
  fuse: {
    threshold: 0.4,
    distance: 100,
    ignoreLocation: false,
    minMatchCharLength: 2,
    isCaseSensitive: false,
    preIndexed: true,
  },
  minisearch: {
    fuzzy: 0.2,
    prefix: true,
    combineWith: 'OR',
    fuzzyWeight: 1,
    prefixWeight: 0.8,
    preIndexed: true,
  },
  ufuzzy: { intraMode: 1, intraSub: 1, intraTrn: 1, intraDel: 1 },
  lunr: { preIndexed: true, wildcard: true, editDistance: 0 },
};

const engineNames: Record<EngineKey, string> = {
  seaq: 'seaq',
  seaqv1: 'seaq v1',
  fuzzysort: 'fuzzysort',
  fuse: 'Fuse.js',
  minisearch: 'MiniSearch',
  ufuzzy: 'uFuzzy',
  lunr: 'Lunr',
};

const engineOrder: EngineKey[] = [
  'seaq',
  'seaqv1',
  'fuzzysort',
  'fuse',
  'minisearch',
  'ufuzzy',
  'lunr',
];

export type EngineToggle = { muted: boolean; soloed: boolean };

type View = 'playground' | 'reference';

/**
 * Hash-based view switching so views are linkable without a router.
 * `#reference` selects the docs view; `#reference/<section>` deep-links
 * into a section (handled inside Reference); anything else is the playground.
 */
function useHashView(): View {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash.startsWith('#reference') ? 'reference' : 'playground';
}

function NavBar({ view }: { view: View }) {
  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${
      active
        ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
        : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
    }`;
  return (
    <nav className="sticky top-0 z-10 mb-6 flex items-center gap-2 border-b border-gray-200 bg-white/90 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90">
      <a href="#playground" className="mr-2 text-lg font-bold text-gray-900 dark:text-white">
        seaq
      </a>
      <a href="#playground" className={tabClass(view === 'playground')}>
        Playground
      </a>
      <a href="#reference" className={tabClass(view === 'reference')}>
        Reference
      </a>
      <a
        href="https://github.com/billie-coop/seaq"
        target="_blank"
        rel="noreferrer"
        className="ml-auto text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
      >
        GitHub ↗
      </a>
    </nav>
  );
}

const defaultToggles: Record<EngineKey, EngineToggle> = Object.fromEntries(
  engineOrder.map((k) => [k, { muted: false, soloed: false }]),
) as Record<EngineKey, EngineToggle>;

export function App() {
  const view = useHashView();
  const [query, setQuery] = useState('');
  const [dataset, setDataset] = useState<SelectableDataset>('contacts');
  const [customDs, setCustomDs] = useState<DatasetConfig | null>(null);
  const [configs, setConfigs] = useState<EngineConfigs>(defaultConfigs);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [toggles, setToggles] = useState<Record<EngineKey, EngineToggle>>(defaultToggles);

  const anySoloed = engineOrder.some((k) => toggles[k].soloed);
  const isActive = useCallback(
    (engine: EngineKey) => {
      if (toggles[engine].muted) return false;
      if (anySoloed) return toggles[engine].soloed;
      return true;
    },
    [toggles, anySoloed],
  );

  const setToggle = useCallback((engine: EngineKey, patch: Partial<EngineToggle>) => {
    setToggles((prev) => ({ ...prev, [engine]: { ...prev[engine], ...patch } }));
  }, []);

  const rawDs = useMemo(
    () => (dataset === 'custom' ? (customDs ?? emptyCustomDataset) : datasets[dataset]),
    [dataset, customDs],
  );
  const allPaths = useMemo(
    () =>
      rawDs.data.length > 0 && typeof rawDs.data[0] === 'object'
        ? discoverStringPaths(rawDs.data as unknown[])
        : [],
    [rawDs],
  );
  const effectiveKeys = selectedKeys.length > 0 ? selectedKeys : rawDs.keys;
  const ds = useMemo(() => ({ ...rawDs, keys: effectiveKeys }), [rawDs, effectiveKeys]);

  // Detect which keys traverse arrays (e.g. emailAddresses.email)
  const arrayKeyMap = useMemo<ArrayKeyMap>(() => {
    if (ds.data.length === 0 || typeof ds.data[0] !== 'object') return {};
    const sample = ds.data[0];
    const map: ArrayKeyMap = {};
    for (const key of ds.keys) {
      const parts = key.split('.');
      let val: unknown = sample;
      for (let i = 0; i < parts.length; i++) {
        if (val == null) break;
        const part = parts[i];
        if (part === undefined) break;
        val = (val as Record<string, unknown>)[part];
        if (Array.isArray(val) && i < parts.length - 1) {
          map[key] = {
            arrayPath: parts.slice(0, i + 1).join('.'),
            innerPath: parts.slice(i + 1).join('.'),
          };
          break;
        }
      }
    }
    return map;
  }, [ds.data, ds.keys]);

  // Clear caches and key selection whenever the underlying data changes
  // (dataset switch or a new custom upload)
  // biome-ignore lint/correctness/useExhaustiveDependencies: rawDs.data identity is the intended trigger
  useEffect(() => {
    clearFuseCache();
    clearFuzzysortCache();
    clearMiniSearchCache();
    clearLunrCache();
    setSelectedKeys([]);
  }, [rawDs.data]);

  const updateConfig = useCallback(
    <K extends EngineKey>(engine: K, patch: Partial<EngineConfigs[K]>) => {
      setConfigs((prev) => ({
        ...prev,
        [engine]: { ...prev[engine], ...patch },
      }));
    },
    [],
  );

  // Run search synchronously on every render — no debounce
  // Only run active (non-muted, respecting solo) engines.
  const results = useMemo<Record<EngineKey, SearchResult | null>>(() => {
    const q = query.trim();
    const empty: Record<EngineKey, SearchResult | null> = {
      seaq: null,
      seaqv1: null,
      fuzzysort: null,
      fuse: null,
      minisearch: null,
      ufuzzy: null,
      lunr: null,
    };
    if (!q) return empty;

    const run: Record<EngineKey, () => SearchResult> = {
      seaq: () => searchSeaq(ds, q, configs.seaq),
      seaqv1: () => searchSeaqV1(ds, q, configs.seaqv1),
      fuzzysort: () => searchFuzzysort(ds, q, configs.fuzzysort),
      fuse: () => searchFuse(ds, q, configs.fuse),
      minisearch: () => searchMiniSearch(ds, q, configs.minisearch),
      ufuzzy: () => searchUFuzzy(ds, q, configs.ufuzzy),
      lunr: () => searchLunr(ds, q, configs.lunr),
    };

    const out = { ...empty };
    for (const engine of engineOrder) {
      if (isActive(engine)) out[engine] = run[engine]();
    }
    return out;
  }, [query, ds, configs, isActive]);

  return (
    <div className="mx-auto min-h-screen max-w-[120rem] bg-white px-4 pb-8 sm:px-6 dark:bg-gray-900">
      <NavBar view={view} />

      {view === 'reference' && <Reference />}

      {/* The playground stays mounted while reading the reference so query,
          custom data, and engine configs survive tab switches */}
      <div className={view === 'playground' ? undefined : 'hidden'}>
        <Hero />

        <div className="mb-6 space-y-4">
          <SearchInput value={query} onChange={setQuery} />
          <DatasetPicker
            selected={dataset}
            onChange={setDataset}
            customLabel={customDs?.label ?? null}
          />
          {dataset === 'custom' && (
            <CustomDataPanel
              current={customDs}
              onLoad={setCustomDs}
              onClear={() => setCustomDs(null)}
            />
          )}
          {allPaths.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
                Search fields:
              </span>
              {allPaths.map((k) => (
                <label
                  key={k}
                  className="flex items-center gap-1 text-xs text-gray-800 dark:text-gray-200"
                >
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 dark:border-gray-600"
                    checked={effectiveKeys.includes(k)}
                    onChange={(e) => {
                      const current = selectedKeys.length > 0 ? selectedKeys : [...rawDs.keys];
                      const next = e.target.checked
                        ? [...current, k].filter((v, i, a) => a.indexOf(v) === i)
                        : current.filter((v) => v !== k);
                      setSelectedKeys(next);
                    }}
                  />
                  <span>
                    {k}
                    {rawDs.keys.includes(k) && (
                      <span className="ml-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                        (default)
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
          {ds.data.length > 0 && (
            <details className="rounded-md border border-gray-200 bg-gray-900 dark:border-gray-700">
              <summary className="cursor-pointer select-none px-4 py-2 text-xs text-gray-400 hover:text-gray-300">
                <span className="font-medium">Sample entry</span>
                {ds.keys.length > 0 && (
                  <span className="ml-2 text-gray-500">keys: [{ds.keys.join(', ')}]</span>
                )}
              </summary>
              <pre className="overflow-x-auto whitespace-pre border-t border-gray-800 px-4 py-3 text-xs leading-relaxed text-gray-100">
                <code>{JSON.stringify(ds.data[0], null, 2)}</code>
              </pre>
            </details>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
          {engineOrder.map((engine) => (
            <ResultsColumn
              key={engine}
              engineKey={engine}
              name={engineNames[engine]}
              query={query}
              keys={ds.keys}
              arrayKeyMap={arrayKeyMap}
              result={results[engine]}
              config={configs[engine]}
              onConfigChange={(patch) => updateConfig(engine, patch)}
              toggle={toggles[engine]}
              onToggle={(patch) => setToggle(engine, patch)}
              active={isActive(engine)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
