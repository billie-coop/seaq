import { Marked } from 'marked';
import { useEffect, useRef, useState } from 'react';
import readme from '../../../core/README.md?raw';

interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Render the README once at module load with heading ids baked into the
 * HTML (post-render DOM patching would be wiped whenever React re-applies
 * innerHTML), collecting the TOC from the same pass.
 */
function buildReference(): { html: string; toc: TocEntry[] } {
  const toc: TocEntry[] = [];
  const marked = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        // The page shell supplies the title; the rest stays sourced from the README.
        if (depth === 1) return '';
        const inline = this.parser.parseInline(tokens);
        const plain = inline.replace(/<[^>]+>/g, '');
        const id = slugify(plain);
        if (depth === 2 || depth === 3) {
          toc.push({ id, text: plain, level: depth });
        }
        return `<h${depth} id="${id}">${inline}</h${depth}>\n`;
      },
      link({ href, tokens }) {
        // README section links must stay inside the hash-based docs view.
        if (href.startsWith('#')) {
          return `<a href="#reference/${href.slice(1)}">${this.parser.parseInline(tokens)}</a>`;
        }
        return false;
      },
    },
  });
  return { html: marked.parse(readme, { async: false }) as string, toc };
}

const { html: referenceHtml, toc: referenceToc } = buildReference();

/** Scroll a section heading under the sticky nav. */
function scrollToSection(id: string): void {
  document.getElementById(id)?.scrollIntoView({ block: 'start' });
}

function currentSection(): string | undefined {
  return window.location.hash.match(/^#reference\/(.+)$/)?.[1];
}

/**
 * The reference docs are the core package README, rendered as-is — one
 * source of truth, so the site can never drift from what ships on npm.
 * The sidebar TOC deep-links to sections via `#reference/<id>` hashes,
 * which compose with the app's hash-based view routing.
 */
export function Reference() {
  const articleRef = useRef<HTMLElement>(null);
  const [activeId, setActiveId] = useState('');

  // Deep links: jump on mount, follow hash changes afterwards
  useEffect(() => {
    const section = currentSection();
    if (section) scrollToSection(section);
    const onHashChange = () => {
      const target = currentSection();
      if (target) scrollToSection(target);
      else if (window.location.hash === '#reference') window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Track the section currently in view to highlight it in the TOC
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (observed) => {
        for (const entry of observed) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            return;
          }
        }
      },
      // A band just below the sticky nav: the heading crossing it is "active"
      { rootMargin: '-64px 0px -75% 0px' },
    );
    for (const h of root.querySelectorAll('h2, h3')) observer.observe(h);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="site-container docs-page">
      <div className="docs-intro">
        <p className="site-eyebrow">seaq</p>
        <h1>Documentation</h1>
        <p>Install, search your data, and explore the API.</p>
      </div>
      <label className="mobile-toc">
        <span>On this page</span>
        <select
          value={activeId}
          onChange={(event) => {
            window.location.hash = `reference/${event.target.value}`;
          }}
        >
          <option value="" disabled>
            Jump to a section…
          </option>
          {referenceToc.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.level === 3 ? '— ' : ''}
              {entry.text}
            </option>
          ))}
        </select>
      </label>
      <div className="reference-layout">
        <nav className="hidden w-56 shrink-0 lg:block" aria-label="Table of contents">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-8">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              On this page
            </p>
            <ul className="space-y-1 border-l border-gray-200 text-sm dark:border-gray-800">
              {referenceToc.map((entry) => (
                <li key={entry.id}>
                  <a
                    href={`#reference/${entry.id}`}
                    className={`-ml-px block border-l py-1 leading-snug ${
                      entry.level === 3 ? 'pl-7' : 'pl-4'
                    } ${
                      activeId === entry.id
                        ? 'toc-active font-medium'
                        : 'border-transparent text-gray-500 hover:border-gray-400 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                    }`}
                  >
                    {entry.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
        <article
          ref={articleRef}
          className="reference-prose prose prose-slate dark:prose-invert min-w-0 max-w-[52rem] flex-1 prose-headings:scroll-mt-24 prose-pre:border prose-pre:border-gray-700/60 prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-pre:shadow-sm prose-code:before:content-none prose-code:after:content-none"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: rendering our own README from this repo, not user input
          dangerouslySetInnerHTML={{ __html: referenceHtml }}
        />
      </div>
    </div>
  );
}
