import { useState } from 'react';

const QUICKSTART = `import { seaq } from '@billie-coop/seaq';

const contacts = [
  { name: 'Helen Green', email: 'helen@example.com' },
  { name: 'Henry Greenberg', email: 'hank@example.com' },
];

seaq(contacts, 'helgre', { keys: ['name', 'email'] });
// => [{ name: 'Helen Green', ... }]`;

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
        <h1>seaq</h1>
        <p className="hero-description">
          Zero-dependency fuzzy search for JavaScript and TypeScript.
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
            Docs →
          </a>
        </div>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-900 p-4 text-xs leading-relaxed text-gray-100 shadow-sm dark:border-gray-700">
        <code>{QUICKSTART}</code>
      </pre>
    </section>
  );
}
