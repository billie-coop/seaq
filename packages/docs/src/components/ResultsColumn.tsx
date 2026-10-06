import {
  type ArrayKeyMap,
  defaultConfigs,
  type EngineConfigs,
  type EngineKey,
  type EngineToggle,
  type FuseConfig,
  type FuzzysortConfig,
  type LunrConfig,
  type MiniSearchConfig,
  type SeaqConfig,
  type SeaqV1Config,
  type UFuzzyConfig,
} from '../App';
import type { SearchResult } from '../engines';

interface ResultsColumnProps {
  engineKey: EngineKey;
  name: string;
  query: string;
  keys: string[];
  arrayKeyMap: ArrayKeyMap;
  result: SearchResult | null;
  config: EngineConfigs[EngineKey];
  onConfigChange: (patch: Partial<EngineConfigs[EngineKey]>) => void;
  toggle: EngineToggle;
  onToggle: (patch: Partial<EngineToggle>) => void;
  active: boolean;
}

function timingColor(ms: number): string {
  if (ms < 5) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
  if (ms < 50) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
  return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
}

const labelClass = 'text-xs text-gray-500 dark:text-gray-400';
const hintClass = 'block text-[10px] text-gray-400 dark:text-gray-500 mt-0.5';
const selectClass =
  'rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200';
const checkClass = 'rounded border-gray-300 dark:border-gray-600';

// ── Code snippet generators ──

function q(s: string): string {
  return `'${s.replace(/'/g, "\\'")}'`;
}

function seaqSnippet(query: string, keys: string[], config: SeaqConfig): string {
  const opts: string[] = [];
  if (keys.length > 0) opts.push(`keys: [${keys.map(q).join(', ')}]`);
  if (config.fuzziness !== 0.2) opts.push(`fuzziness: ${config.fuzziness}`);
  if (config.fieldMode !== 'joined') opts.push(`fieldMode: '${config.fieldMode}'`);
  if (config.limit != null && config.limit !== 10) opts.push(`limit: ${config.limit}`);
  if (config.threshold !== 0.3) opts.push(`threshold: ${config.threshold}`);
  if (config.cache) opts.push(`cache: true`);
  const optsStr = opts.length > 0 ? `, {\n  ${opts.join(',\n  ')}\n}` : '';
  return `seaq(data, ${q(query)}${optsStr})`;
}

function seaqV1Snippet(query: string, keys: string[], config: SeaqV1Config): string {
  const args: string[] = [`data`, q(query)];
  if (keys.length > 0) args.push(`[${keys.map(q).join(', ')}]`);
  if (config.fuzziness) args.push(String(config.fuzziness));
  return `seaq(${args.join(', ')})`;
}

function fuseSnippet(query: string, keys: string[], config: FuseConfig): string {
  const opts: string[] = [];
  if (keys.length > 0) opts.push(`keys: [${keys.map(q).join(', ')}]`);
  opts.push(`threshold: ${config.threshold}`);
  if (config.distance !== 100) opts.push(`distance: ${config.distance}`);
  if (config.ignoreLocation) opts.push(`ignoreLocation: true`);
  if (config.minMatchCharLength > 1) opts.push(`minMatchCharLength: ${config.minMatchCharLength}`);
  if (config.isCaseSensitive) opts.push(`isCaseSensitive: true`);
  return [
    `const fuse = new Fuse(data, {`,
    `  ${opts.join(',\n  ')}`,
    `})`,
    `fuse.search(${q(query)})`,
  ].join('\n');
}

function fuzzysortSnippet(query: string, keys: string[], config: FuzzysortConfig): string {
  const opts: string[] = [];
  if (config.threshold !== 0.5) opts.push(`threshold: ${config.threshold}`);
  if (config.limit !== 10) opts.push(`limit: ${config.limit}`);
  const optsStr = opts.length > 0 ? `, {\n  ${opts.join(',\n  ')}\n}` : '';
  const snapshot =
    keys.length > 0
      ? `fuzzysort.snapshot(data, {\n  keys: [${keys.map(q).join(', ')}]\n})`
      : `fuzzysort.snapshot(data)`;
  const lines = [`const targets = ${snapshot}`];
  if (config.preIndexed) lines.push(`// snapshot taken once, reused`);
  lines.push(`fuzzysort.go(${q(query)}, targets${optsStr})`);
  return lines.join('\n');
}

function miniSearchSnippet(
  query: string,
  keys: string[],
  arrayKeyMap: ArrayKeyMap,
  config: MiniSearchConfig,
): string {
  const fields = keys.length > 0 ? keys.map((k) => q(k.replace(/\./g, '_'))).join(', ') : "'text'";
  const searchOpts: string[] = [];
  searchOpts.push(`prefix: ${config.prefix}`);
  searchOpts.push(`fuzzy: ${config.fuzzy}`);
  if (config.combineWith !== 'OR') searchOpts.push(`combineWith: '${config.combineWith}'`);
  if (config.fuzzyWeight !== 0.45 || config.prefixWeight !== 0.375) {
    searchOpts.push(`weights: { fuzzy: ${config.fuzzyWeight}, prefix: ${config.prefixWeight} }`);
  }

  const nestedKeys = keys.filter((k) => k.includes('.'));

  if (nestedKeys.length > 0) {
    const extractCases = nestedKeys.map((k) => {
      const flat = k.replace(/\./g, '_');
      const arrayInfo = arrayKeyMap[k];
      if (arrayInfo) {
        return `    if (field === '${flat}')\n      return doc.${arrayInfo.arrayPath}\n        .map(e => e.${arrayInfo.innerPath}).join(' ')`;
      }
      return `    if (field === '${flat}')\n      return doc.${k}`;
    });
    return [
      `const ms = new MiniSearch({`,
      `  fields: [${fields}],`,
      `  extractField: (doc, field) => {`,
      ...extractCases,
      `    return doc[field]`,
      `  }`,
      `})`,
      `ms.addAll(data)`,
      `ms.search(${q(query)}, {`,
      `  ${searchOpts.join(',\n  ')}`,
      `})`,
    ].join('\n');
  }

  return [
    `const ms = new MiniSearch({`,
    `  fields: [${fields}]`,
    `})`,
    `ms.addAll(data)`,
    `ms.search(${q(query)}, {`,
    `  ${searchOpts.join(',\n  ')}`,
    `})`,
  ].join('\n');
}

function uFuzzySnippet(query: string, config: UFuzzyConfig): string {
  const ctorOpts: string[] = [];
  if (config.intraMode !== 0) {
    ctorOpts.push(`intraMode: ${config.intraMode}`);
    if (config.intraSub) ctorOpts.push(`intraSub: 1`);
    if (config.intraTrn) ctorOpts.push(`intraTrn: 1`);
    if (config.intraDel) ctorOpts.push(`intraDel: 1`);
  }
  const ctorStr = ctorOpts.length > 0 ? `{\n  ${ctorOpts.join(',\n  ')}\n}` : '';
  return [
    `const uf = new uFuzzy(${ctorStr})`,
    `const [idxs, info, order] = uf.search(`,
    `  haystack, ${q(query)}`,
    `)`,
  ].join('\n');
}

function lunrSnippet(
  query: string,
  keys: string[],
  arrayKeyMap: ArrayKeyMap,
  config: LunrConfig,
): string {
  const fields = keys.length > 0 ? keys.map((k) => k.replace(/\./g, '_')) : ['text'];
  const fieldLines = fields
    .map((f, i) => {
      const origKey = keys[i];
      if (origKey?.includes('.')) {
        const arrayInfo = origKey ? arrayKeyMap[origKey] : undefined;
        if (arrayInfo) {
          return [
            `  this.field('${f}', {`,
            `    extractor: (doc) => doc.${arrayInfo.arrayPath}`,
            `      .map(e => e.${arrayInfo.innerPath}).join(' ')`,
            `  })`,
          ].join('\n');
        }
        return [`  this.field('${f}', {`, `    extractor: (doc) => doc.${origKey}`, `  })`].join(
          '\n',
        );
      }
      return `  this.field('${f}')`;
    })
    .join('\n');
  const lines = [
    `const idx = lunr(function() {`,
    `  this.ref('id')`,
    fieldLines,
    `  data.forEach(d => this.add(d))`,
    `})`,
  ];
  if (config.preIndexed) {
    lines.push(`// index built once, reused`);
  }
  let searchQuery = query;
  if (config.wildcard) {
    searchQuery = query
      .split(/\s+/)
      .map((t) => `*${t}*`)
      .join(' ');
  } else if (config.editDistance > 0) {
    searchQuery = query
      .split(/\s+/)
      .map((t) => `${t}~${config.editDistance}`)
      .join(' ');
  }
  lines.push(`idx.search(${q(searchQuery)})`);
  return lines.join('\n');
}

function codeSnippet(
  engineKey: EngineKey,
  query: string,
  keys: string[],
  arrayKeyMap: ArrayKeyMap,
  config: EngineConfigs[EngineKey],
): string {
  const dq = query || '...';
  switch (engineKey) {
    case 'seaq':
      return seaqSnippet(dq, keys, config as SeaqConfig);
    case 'seaqv1':
      return seaqV1Snippet(dq, keys, config as SeaqV1Config);
    case 'fuzzysort':
      return fuzzysortSnippet(dq, keys, config as FuzzysortConfig);
    case 'fuse':
      return fuseSnippet(dq, keys, config as FuseConfig);
    case 'minisearch':
      return miniSearchSnippet(dq, keys, arrayKeyMap, config as MiniSearchConfig);
    case 'ufuzzy':
      return uFuzzySnippet(dq, config as UFuzzyConfig);
    case 'lunr':
      return lunrSnippet(dq, keys, arrayKeyMap, config as LunrConfig);
  }
}

// ── Shared control component ──

function Select({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: string | number;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className={labelClass}>
        {label}:{' '}
        <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <span className={hintClass}>{hint}</span>
    </div>
  );
}

function Check({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div>
      <label className={`${labelClass} flex items-center gap-1`}>
        <input
          type="checkbox"
          className={checkClass}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
      <span className={hintClass}>{hint}</span>
    </div>
  );
}

// ── Config controls ──

function SeaqControls({
  config,
  onChange,
}: {
  config: SeaqConfig;
  onChange: (p: Partial<SeaqConfig>) => void;
}) {
  return (
    <>
      <Select
        label="Fuzziness"
        hint="Typo tolerance. 0 = strict, every char must match."
        value={config.fuzziness}
        options={[
          { value: '0.2', label: '0.2 (default)' },
          { value: '0.1', label: '0.1' },
          { value: '0.3', label: '0.3' },
          { value: '0.5', label: '0.5' },
          { value: '0.8', label: '0.8' },
          { value: '0', label: '0 (strict)' },
        ]}
        onChange={(v) => onChange({ fuzziness: Number(v) })}
      />
      <Select
        label="Field mode"
        hint='Joined = cross-field "helen green". Separate = best single field.'
        value={config.fieldMode}
        options={[
          { value: 'joined', label: 'joined (default)' },
          { value: 'separate', label: 'separate' },
        ]}
        onChange={(v) => onChange({ fieldMode: v as 'joined' | 'separate' })}
      />
      <Select
        label="Threshold"
        hint="Relative cutoff: drop results below topScore × threshold."
        value={config.threshold}
        options={[
          { value: '0', label: '0 (off)' },
          { value: '0.1', label: '0.1' },
          { value: '0.2', label: '0.2' },
          { value: '0.3', label: '0.3 (default)' },
          { value: '0.5', label: '0.5' },
          { value: '0.7', label: '0.7' },
          { value: '1', label: '1 (exact only)' },
        ]}
        onChange={(v) => onChange({ threshold: Number(v) })}
      />
      <Select
        label="Limit"
        hint="Max results. Uses min-heap for O(n log k) efficiency."
        value={config.limit ?? 'off'}
        options={[
          { value: '10', label: '10 (default)' },
          { value: '25', label: '25' },
          { value: '50', label: '50' },
          { value: '100', label: '100' },
          { value: 'off', label: 'All' },
        ]}
        onChange={(v) => onChange({ limit: v === 'off' ? undefined : Number(v) })}
      />
      <Check
        label="Cache"
        hint="Reuse prepared strings across searches (typeahead on static data)."
        checked={config.cache}
        onChange={(v) => onChange({ cache: v })}
      />
    </>
  );
}

function SeaqV1Controls({
  config,
  onChange,
}: {
  config: SeaqV1Config;
  onChange: (p: Partial<SeaqV1Config>) => void;
}) {
  return (
    <Select
      label="Fuzziness"
      hint="Typo tolerance. 0 = strict (v1 default)."
      value={config.fuzziness}
      options={[
        { value: '0', label: '0 (strict)' },
        { value: '0.2', label: '0.2 (default)' },
        { value: '0.5', label: '0.5' },
        { value: '0.8', label: '0.8' },
        { value: '1', label: '1' },
      ]}
      onChange={(v) => onChange({ fuzziness: Number(v) })}
    />
  );
}

function FuseControls({
  config,
  onChange,
}: {
  config: FuseConfig;
  onChange: (p: Partial<FuseConfig>) => void;
}) {
  return (
    <>
      <Select
        label="Threshold"
        hint="0 = perfect match only. 1 = match anything."
        value={config.threshold}
        options={[
          { value: '0.1', label: '0.1 (strict)' },
          { value: '0.2', label: '0.2' },
          { value: '0.4', label: '0.4 (default)' },
          { value: '0.6', label: '0.6 (loose)' },
          { value: '0.8', label: '0.8' },
        ]}
        onChange={(v) => onChange({ threshold: Number(v) })}
      />
      <Select
        label="Distance"
        hint="How far from expected location a match can be."
        value={config.distance}
        options={[
          { value: '10', label: '10 (strict)' },
          { value: '50', label: '50' },
          { value: '100', label: '100 (default)' },
          { value: '500', label: '500' },
          { value: '1000', label: '1000 (loose)' },
        ]}
        onChange={(v) => onChange({ distance: Number(v) })}
      />
      <Check
        label="Ignore location"
        hint="Matches anywhere in the string score equally."
        checked={config.ignoreLocation}
        onChange={(v) => onChange({ ignoreLocation: v })}
      />
      <Select
        label="Min match length"
        hint="Filters out short matches to reduce noise."
        value={config.minMatchCharLength}
        options={[
          { value: '1', label: '1 (default)' },
          { value: '2', label: '2' },
          { value: '3', label: '3' },
          { value: '4', label: '4' },
        ]}
        onChange={(v) => onChange({ minMatchCharLength: Number(v) })}
      />
      <Check
        label="Case sensitive"
        hint="Distinguish upper/lowercase."
        checked={config.isCaseSensitive}
        onChange={(v) => onChange({ isCaseSensitive: v })}
      />
      <Check
        label="Pre-indexed"
        hint="Reuse index across keystrokes."
        checked={config.preIndexed}
        onChange={(v) => onChange({ preIndexed: v })}
      />
    </>
  );
}

function FuzzysortControls({
  config,
  onChange,
}: {
  config: FuzzysortConfig;
  onChange: (p: Partial<FuzzysortConfig>) => void;
}) {
  return (
    <>
      <Select
        label="Threshold"
        hint="Minimum score. 1 = exact, 0.5 = good, 0 = any match."
        value={config.threshold}
        options={[
          { value: '0', label: '0 (any match)' },
          { value: '0.3', label: '0.3' },
          { value: '0.5', label: '0.5 (default)' },
          { value: '0.7', label: '0.7 (strict)' },
        ]}
        onChange={(v) => onChange({ threshold: Number(v) })}
      />
      <Select
        label="Limit"
        hint="Max results. 0 = unlimited (slower on big data)."
        value={config.limit}
        options={[
          { value: '10', label: '10 (default)' },
          { value: '100', label: '100' },
          { value: '0', label: '0 (unlimited)' },
        ]}
        onChange={(v) => onChange({ limit: Number(v) })}
      />
      <Check
        label="Pre-indexed"
        hint="Reuse snapshot() across keystrokes."
        checked={config.preIndexed}
        onChange={(v) => onChange({ preIndexed: v })}
      />
    </>
  );
}

function MiniSearchControls({
  config,
  onChange,
}: {
  config: MiniSearchConfig;
  onChange: (p: Partial<MiniSearchConfig>) => void;
}) {
  return (
    <>
      <Select
        label="Fuzzy"
        hint="Edit distance as fraction of term length."
        value={config.fuzzy}
        options={[
          { value: '0', label: '0 (off)' },
          { value: '0.1', label: '0.1' },
          { value: '0.2', label: '0.2 (default)' },
          { value: '0.4', label: '0.4' },
        ]}
        onChange={(v) => onChange({ fuzzy: Number(v) })}
      />
      <Check
        label="Prefix"
        hint='"hel" matches "hello".'
        checked={config.prefix}
        onChange={(v) => onChange({ prefix: v })}
      />
      <Select
        label="Combine"
        hint="OR = any term. AND = all terms required."
        value={config.combineWith}
        options={[
          { value: 'OR', label: 'OR (default)' },
          { value: 'AND', label: 'AND' },
        ]}
        onChange={(v) => onChange({ combineWith: v as 'OR' | 'AND' })}
      />
      <Select
        label="Fuzzy weight"
        hint="Scoring weight for fuzzy matches vs exact (1.0)."
        value={config.fuzzyWeight}
        options={[
          { value: '0.2', label: '0.2' },
          { value: '0.45', label: '0.45 (default)' },
          { value: '0.7', label: '0.7' },
          { value: '1', label: '1.0' },
        ]}
        onChange={(v) => onChange({ fuzzyWeight: Number(v) })}
      />
      <Select
        label="Prefix weight"
        hint="Scoring weight for prefix matches vs exact (1.0)."
        value={config.prefixWeight}
        options={[
          { value: '0.2', label: '0.2' },
          { value: '0.375', label: '0.375 (default)' },
          { value: '0.6', label: '0.6' },
          { value: '1', label: '1.0' },
        ]}
        onChange={(v) => onChange({ prefixWeight: Number(v) })}
      />
      <Check
        label="Pre-indexed"
        hint="Reuse index across keystrokes."
        checked={config.preIndexed}
        onChange={(v) => onChange({ preIndexed: v })}
      />
    </>
  );
}

function UFuzzyControls({
  config,
  onChange,
}: {
  config: UFuzzyConfig;
  onChange: (p: Partial<UFuzzyConfig>) => void;
}) {
  return (
    <>
      <Select
        label="Intra mode"
        hint="0 = extra chars between. 1 = single-error typo tolerance."
        value={config.intraMode}
        options={[
          { value: '0', label: '0 (multi-insert)' },
          { value: '1', label: '1 (single-error)' },
        ]}
        onChange={(v) => onChange({ intraMode: Number(v) as 0 | 1 })}
      />
      {config.intraMode === 1 && (
        <>
          <Check
            label="Substitutions"
            hint="Allow a wrong char, e.g. 'hallo' → 'hello'."
            checked={config.intraSub === 1}
            onChange={(v) => onChange({ intraSub: v ? 1 : 0 })}
          />
          <Check
            label="Transpositions"
            hint="Allow swapped chars, e.g. 'hlelo' → 'hello'."
            checked={config.intraTrn === 1}
            onChange={(v) => onChange({ intraTrn: v ? 1 : 0 })}
          />
          <Check
            label="Deletions"
            hint="Allow missing chars, e.g. 'helo' → 'hello'."
            checked={config.intraDel === 1}
            onChange={(v) => onChange({ intraDel: v ? 1 : 0 })}
          />
        </>
      )}
    </>
  );
}

function LunrControls({
  config,
  onChange,
}: {
  config: LunrConfig;
  onChange: (p: Partial<LunrConfig>) => void;
}) {
  return (
    <>
      <Check
        label="Wildcard"
        hint="Wraps each term in *term* for partial matching."
        checked={config.wildcard}
        onChange={(v) => onChange({ wildcard: v, ...(v ? { editDistance: 0 } : {}) })}
      />
      <Select
        label="Edit distance"
        hint="Fuzzy ~N suffix. Higher = more typo tolerance."
        value={config.editDistance}
        options={[
          { value: '0', label: '0 (exact)' },
          { value: '1', label: '1' },
          { value: '2', label: '2' },
        ]}
        onChange={(v) =>
          onChange({ editDistance: Number(v), ...(Number(v) > 0 ? { wildcard: false } : {}) })
        }
      />
      <Check
        label="Pre-indexed"
        hint="Reuse index across keystrokes."
        checked={config.preIndexed}
        onChange={(v) => onChange({ preIndexed: v })}
      />
    </>
  );
}

function ConfigControls({ engineKey, config, onConfigChange }: ResultsColumnProps) {
  switch (engineKey) {
    case 'seaq':
      return (
        <SeaqControls
          config={config as SeaqConfig}
          onChange={onConfigChange as (p: Partial<SeaqConfig>) => void}
        />
      );
    case 'seaqv1':
      return (
        <SeaqV1Controls
          config={config as SeaqV1Config}
          onChange={onConfigChange as (p: Partial<SeaqV1Config>) => void}
        />
      );
    case 'fuzzysort':
      return (
        <FuzzysortControls
          config={config as FuzzysortConfig}
          onChange={onConfigChange as (p: Partial<FuzzysortConfig>) => void}
        />
      );
    case 'fuse':
      return (
        <FuseControls
          config={config as FuseConfig}
          onChange={onConfigChange as (p: Partial<FuseConfig>) => void}
        />
      );
    case 'minisearch':
      return (
        <MiniSearchControls
          config={config as MiniSearchConfig}
          onChange={onConfigChange as (p: Partial<MiniSearchConfig>) => void}
        />
      );
    case 'ufuzzy':
      return (
        <UFuzzyControls
          config={config as UFuzzyConfig}
          onChange={onConfigChange as (p: Partial<UFuzzyConfig>) => void}
        />
      );
    case 'lunr':
      return (
        <LunrControls
          config={config as LunrConfig}
          onChange={onConfigChange as (p: Partial<LunrConfig>) => void}
        />
      );
  }
}

// ── Main component ──

const toggleBtnBase = 'w-5 h-5 rounded text-[10px] font-bold leading-none transition-colors';

export function ResultsColumn(props: ResultsColumnProps) {
  const { name, query, keys, arrayKeyMap, engineKey, config, result, toggle, onToggle, active } =
    props;
  const snippet = codeSnippet(engineKey, query, keys, arrayKeyMap, config);

  return (
    <div
      className={`flex min-w-0 flex-1 flex-col rounded-lg border shadow-sm transition-opacity ${
        active
          ? 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
          : 'border-gray-200/50 bg-gray-50 opacity-40 dark:border-gray-700/50 dark:bg-gray-800/50'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <button
            type="button"
            title="Solo — only run this engine (Shift+click to add)"
            className={`${toggleBtnBase} ${
              toggle.soloed
                ? 'bg-amber-400 text-amber-900 hover:bg-amber-500'
                : 'bg-gray-200 text-gray-500 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-400 dark:hover:bg-gray-500'
            }`}
            onClick={() => onToggle({ soloed: !toggle.soloed })}
          >
            S
          </button>
          <button
            type="button"
            title="Mute — disable this engine"
            className={`${toggleBtnBase} ${
              toggle.muted
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-gray-200 text-gray-500 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-400 dark:hover:bg-gray-500'
            }`}
            onClick={() => onToggle({ muted: !toggle.muted })}
          >
            M
          </button>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{name}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
            onClick={() =>
              props.onConfigChange(defaultConfigs[engineKey] as Partial<EngineConfigs[EngineKey]>)
            }
          >
            Reset
          </button>
          {result && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${timingColor(result.timeMs)}`}
            >
              {result.timeMs.toFixed(1)}ms
            </span>
          )}
        </div>
      </div>

      {/* Config controls */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 border-b border-gray-100 px-4 py-2 dark:border-gray-700/50">
        <ConfigControls {...props} />
      </div>

      {/* Code snippet */}
      <div className="border-b border-gray-100 bg-gray-900 px-3 py-2 dark:border-gray-700/50">
        <pre className="whitespace-pre-wrap break-all text-[9px] leading-snug text-gray-100">
          <code>{snippet}</code>
        </pre>
      </div>

      {/* Results */}
      <div className="flex-1 px-4 py-3">
        {!result ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">Type a query to search...</p>
        ) : result.results.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">No results</p>
        ) : (
          <>
            <ul className="space-y-0.5">
              {result.highlighted.map((html, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: results re-render fully per query; index is stable within a render
                <li key={i}>
                  <details className="group">
                    <summary
                      className="cursor-pointer whitespace-pre-wrap text-[11px] leading-snug text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: html is pre-escaped by buildFieldsHtml/highlightTerms before <mark> insertion
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                    <pre className="mt-1 mb-1 overflow-x-auto rounded bg-gray-900 px-2 py-1.5 text-[9px] leading-snug text-gray-100">
                      <code>{JSON.stringify(result.items[i], null, 2)}</code>
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
              {result.resultCount} result{result.resultCount !== 1 ? 's' : ''}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
