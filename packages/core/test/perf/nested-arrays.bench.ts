/**
 * Nested Object & Array Performance Benchmark
 *
 * Tests seaq's unique ability to search nested objects and arrays.
 * Other libraries require flattening data first - we measure that overhead.
 */
import Fuse from 'fuse.js';
import MiniSearch from 'minisearch';
import { bench, describe } from 'vitest';
import { seaq } from '../../src/index';

// ============================================================================
// Test Data: Deeply nested structure (like a real contacts/CRM app)
// ============================================================================

interface Contact {
  id: number;
  name: string;
  emails: Array<{ type: string; address: string }>;
  phones: Array<{ type: string; number: string }>;
  addresses: Array<{
    type: string;
    street: string;
    city: string;
    state: string;
    zip: string;
  }>;
  tags: string[];
  company: {
    name: string;
    department: string;
    role: string;
  };
}

// Generate test data
function generateContacts(count: number): Contact[] {
  const firstNames = [
    'John',
    'Jane',
    'Mike',
    'Sarah',
    'David',
    'Emily',
    'Chris',
    'Lisa',
    'Tom',
    'Anna',
  ];
  const lastNames = [
    'Smith',
    'Johnson',
    'Williams',
    'Brown',
    'Jones',
    'Garcia',
    'Miller',
    'Davis',
    'Wilson',
    'Anderson',
  ];
  const companies = [
    'Acme Corp',
    'TechStart',
    'BigCorp',
    'StartupCo',
    'MegaInc',
    'DataSystems',
    'CloudNine',
    'DevHouse',
  ];
  const cities = [
    'New York',
    'Los Angeles',
    'Chicago',
    'Houston',
    'Phoenix',
    'Philadelphia',
    'San Antonio',
    'San Diego',
  ];
  const states = ['NY', 'CA', 'IL', 'TX', 'AZ', 'PA', 'TX', 'CA'];
  const departments = [
    'Engineering',
    'Sales',
    'Marketing',
    'HR',
    'Finance',
    'Operations',
    'Legal',
    'Support',
  ];
  const roles = [
    'Manager',
    'Director',
    'Engineer',
    'Analyst',
    'Lead',
    'VP',
    'Associate',
    'Specialist',
  ];
  const emailDomains = ['gmail.com', 'yahoo.com', 'company.com', 'work.org', 'mail.net'];
  const tags = ['vip', 'lead', 'customer', 'prospect', 'partner', 'vendor', 'internal', 'external'];

  const contacts: Contact[] = [];

  for (let i = 0; i < count; i++) {
    const firstName = firstNames[i % firstNames.length];
    const lastName = lastNames[Math.floor(i / firstNames.length) % lastNames.length];
    const cityIdx = i % cities.length;

    contacts.push({
      id: i,
      name: `${firstName} ${lastName}`,
      emails: [
        {
          type: 'work',
          address: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${emailDomains[i % emailDomains.length]}`,
        },
        { type: 'personal', address: `${firstName.toLowerCase()}${i}@gmail.com` },
      ],
      phones: [
        { type: 'mobile', number: `555-${String(i).padStart(4, '0')}` },
        { type: 'work', number: `800-555-${String(i).padStart(4, '0')}` },
      ],
      addresses: [
        {
          type: 'home',
          street: `${100 + i} Main St`,
          city: cities[cityIdx],
          state: states[cityIdx],
          zip: `${10000 + i}`,
        },
        {
          type: 'work',
          street: `${200 + i} Business Ave`,
          city: cities[(cityIdx + 1) % cities.length],
          state: states[(cityIdx + 1) % states.length],
          zip: `${20000 + i}`,
        },
      ],
      tags: [tags[i % tags.length], tags[(i + 3) % tags.length]],
      company: {
        name: companies[i % companies.length],
        department: departments[i % departments.length],
        role: roles[i % roles.length],
      },
    });
  }

  return contacts;
}

const contacts1K = generateContacts(1000);
const contacts5K = generateContacts(5000);

// ============================================================================
// Flattened data for libraries that don't support nested access
// ============================================================================

interface FlatContact {
  id: number;
  name: string;
  email1: string;
  email2: string;
  phone1: string;
  phone2: string;
  city1: string;
  city2: string;
  tags: string;
  companyName: string;
  department: string;
  role: string;
}

function flattenContacts(contacts: Contact[]): FlatContact[] {
  return contacts.map((c) => ({
    id: c.id,
    name: c.name,
    email1: c.emails[0]?.address ?? '',
    email2: c.emails[1]?.address ?? '',
    phone1: c.phones[0]?.number ?? '',
    phone2: c.phones[1]?.number ?? '',
    city1: c.addresses[0]?.city ?? '',
    city2: c.addresses[1]?.city ?? '',
    tags: c.tags.join(' '),
    companyName: c.company.name,
    department: c.company.department,
    role: c.company.role,
  }));
}

const flat1K = flattenContacts(contacts1K);
const flat5K = flattenContacts(contacts5K);

// Pre-built indexes for fair comparison
const fuse1K = new Fuse(contacts1K, {
  keys: ['emails.address', 'company.name', 'addresses.city'],
  threshold: 0.4,
});

const fuse5K = new Fuse(contacts5K, {
  keys: ['emails.address', 'company.name', 'addresses.city'],
  threshold: 0.4,
});

const mini1K = new MiniSearch({
  fields: ['email1', 'email2', 'companyName', 'city1', 'city2'],
  storeFields: ['id', 'name'],
});
mini1K.addAll(flat1K);

const mini5K = new MiniSearch({
  fields: ['email1', 'email2', 'companyName', 'city1', 'city2'],
  storeFields: ['id', 'name'],
});
mini5K.addAll(flat5K);

// ============================================================================
// Benchmarks: Nested property search
// ============================================================================

describe('Nested object search: company.name', () => {
  describe('1K contacts', () => {
    bench('seaq (native nested)', () => {
      seaq(contacts1K, 'Acme', { keys: ['company.name'] });
    });

    bench('fuse.js (native nested)', () => {
      fuse1K.search('Acme');
    });

    bench('minisearch (pre-flattened)', () => {
      mini1K.search('Acme');
    });
  });

  describe('5K contacts', () => {
    bench('seaq (native nested)', () => {
      seaq(contacts5K, 'Acme', { keys: ['company.name'] });
    });

    bench('fuse.js (native nested)', () => {
      fuse5K.search('Acme');
    });

    bench('minisearch (pre-flattened)', () => {
      mini5K.search('Acme');
    });
  });
});

describe('Array field search: emails.address', () => {
  describe('1K contacts', () => {
    bench('seaq (native array traversal)', () => {
      seaq(contacts1K, 'gmail', { keys: ['emails.address'] });
    });

    bench('fuse.js (native array)', () => {
      fuse1K.search('gmail');
    });

    bench('minisearch (pre-flattened email1+email2)', () => {
      mini1K.search('gmail');
    });
  });

  describe('5K contacts', () => {
    bench('seaq (native array traversal)', () => {
      seaq(contacts5K, 'gmail', { keys: ['emails.address'] });
    });

    bench('fuse.js (native array)', () => {
      fuse5K.search('gmail');
    });

    bench('minisearch (pre-flattened)', () => {
      mini5K.search('gmail');
    });
  });
});

describe('Deep nested: addresses.city', () => {
  describe('1K contacts', () => {
    bench('seaq (native)', () => {
      seaq(contacts1K, 'New York', { keys: ['addresses.city'] });
    });

    bench('fuse.js (native)', () => {
      new Fuse(contacts1K, { keys: ['addresses.city'] }).search('New York');
    });

    bench('minisearch (pre-flattened)', () => {
      mini1K.search('New York');
    });
  });
});

// ============================================================================
// Cold start: Include flattening overhead for MiniSearch
// ============================================================================

describe('Cold start with nested data (includes data prep)', () => {
  describe('1K contacts', () => {
    bench('seaq (no prep needed)', () => {
      // cache: false — cold; by default a repeated array gets indexed
      seaq(contacts1K, 'Acme', { keys: ['company.name', 'emails.address'], cache: false });
    });

    bench('fuse.js (index build)', () => {
      const fuse = new Fuse(contacts1K, { keys: ['company.name', 'emails.address'] });
      fuse.search('Acme');
    });

    bench('minisearch (flatten + index)', () => {
      const flat = flattenContacts(contacts1K);
      const ms = new MiniSearch({ fields: ['companyName', 'email1', 'email2'] });
      ms.addAll(flat);
      ms.search('Acme');
    });
  });

  describe('5K contacts', () => {
    bench('seaq (no prep needed)', () => {
      seaq(contacts5K, 'Acme', { keys: ['company.name', 'emails.address'], cache: false });
    });

    bench('fuse.js (index build)', () => {
      const fuse = new Fuse(contacts5K, { keys: ['company.name', 'emails.address'] });
      fuse.search('Acme');
    });

    bench('minisearch (flatten + index)', () => {
      const flat = flattenContacts(contacts5K);
      const ms = new MiniSearch({ fields: ['companyName', 'email1', 'email2'] });
      ms.addAll(flat);
      ms.search('Acme');
    });
  });
});

// ============================================================================
// Multi-field nested search
// ============================================================================

describe('Multi-field nested search', () => {
  bench('seaq: search name + company + city', () => {
    // cache: false — cold, like the Fuse.js index built inside each iteration
    seaq(contacts1K, 'John Acme', {
      keys: ['name', 'company.name', 'addresses.city'],
      cache: false,
    });
  });

  bench('fuse.js: search name + company + city', () => {
    new Fuse(contacts1K, { keys: ['name', 'company.name', 'addresses.city'] }).search('John Acme');
  });
});
