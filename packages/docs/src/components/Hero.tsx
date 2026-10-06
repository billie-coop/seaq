import { useState } from 'react';

const QUICKSTART = `import { seaq } from 'seaq';

const contacts = [
  { name: 'Helen Green', email: 'helen@example.com' },
  { name: 'Henry Greenberg', email: 'hank@example.com' },
];

seaq(contacts, 'helgre', { keys: ['name', 'email'] });
// => [{ name: 'Helen Green', ... }]  — no index, no setup`;

export function Hero() {
  const [copied, setCopied] = useState(false);

  function copyInstall() {
    navigator.clipboard.writeText('npm install seaq').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <section className="mb-10 grid gap-6 lg:grid-cols-2 lg:items-center">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white">seaq</h1>
        <p className="mt-3 text-lg text-gray-600 dark:text-gray-300">
          Zero-dependency fuzzy search. One function, no index, no setup — works the same on 20
          items or 20,000.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={copyInstall}
            title="Copy to clipboard"
            className="group flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 font-mono text-sm text-gray-100 shadow-sm hover:bg-gray-800 dark:bg-gray-800 dark:hover:bg-gray-700"
          >
            <span className="text-gray-500">$</span> npm install seaq
            <span className="text-xs text-gray-400 group-hover:text-gray-200">
              {copied ? '✓ copied' : 'copy'}
            </span>
          </button>
          <a
            href="#reference"
            className="rounded-md px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-800"
          >
            Read the docs →
          </a>
        </div>
        <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">
          Everything below is live: pick a dataset — or paste your own JSON — and compare seaq
          against fuzzysort, Fuse.js, MiniSearch, uFuzzy, and Lunr as you type.
        </p>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-900 p-4 text-xs leading-relaxed text-gray-100 shadow-sm dark:border-gray-700">
        <code>{QUICKSTART}</code>
      </pre>
    </section>
  );
}
