import { useState } from 'react';

const QUICKSTART = `import { seaq } from '@billie-coop/seaq';

const contacts = [
  { name: 'Helen Green', email: 'helen@example.com' },
  { name: 'Henry Greenberg', email: 'hank@example.com' },
];

seaq(contacts, 'helgre', { keys: ['name', 'email'] });
// => [{ name: 'Helen Green', ... }]  — no setup, no index to manage`;

export function Hero() {
  const [copied, setCopied] = useState(false);

  function copyInstall() {
    navigator.clipboard.writeText('npm install @billie-coop/seaq').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <section className="site-container site-hero">
      <div>
        <p className="site-eyebrow">Open source by Billie co-op</p>
        <h1>seaq</h1>
        <p className="hero-description">
          Zero-dependency fuzzy search. One function, no setup, no index to manage — works the same
          on 20 items or 20,000.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={copyInstall}
            title="Copy to clipboard"
            className="install-button group"
          >
            <span aria-hidden="true">$</span> npm install @billie-coop/seaq
            <span className="install-copy" aria-live="polite">
              {copied ? '✓ copied' : 'copy'}
            </span>
          </button>
          <a href="#reference" className="docs-link">
            Read the docs →
          </a>
        </div>
        <p className="hero-note">
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
