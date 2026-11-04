/** Acronym queries and the item each should rank first. */
export const places = [
  'New York City',
  'Los Angeles',
  'San Francisco',
  'Las Vegas',
  'New Orleans',
  'Salt Lake City',
  'Kansas City',
  'Oklahoma City',
  'New York',
  'North Carolina',
  'South Carolina',
  'West Virginia',
  'New Hampshire',
  'New Jersey',
  'New Mexico',
  'Hillsdale Michigan',
  'Historical Museum',
  'High Mountain',
  'himalayas',
];

export const companies = [
  'International Business Machines', // IBM
  'American Telephone Telegraph', // ATT
  'Hewlett Packard Enterprise', // HPE
  'General Electric Company', // GEC/GE
  'Federal Bureau Investigation', // FBI
  'Central Intelligence Agency', // CIA
  'National Aeronautics Space Administration', // NASA
  'United States America', // USA
  'United Kingdom', // UK
  'European Union', // EU
  'International Monetary Fund', // IMF
  'World Health Organization', // WHO
  'North Atlantic Treaty Organization', // NATO
];

export const techTerms = [
  'Application Programming Interface', // API
  'Graphical User Interface', // GUI
  'Command Line Interface', // CLI
  'Software Development Kit', // SDK
  'Integrated Development Environment', // IDE
  'Object Oriented Programming', // OOP
  'Test Driven Development', // TDD
  'Continuous Integration Deployment', // CI/CD
  'Single Page Application', // SPA
  'Progressive Web App', // PWA
  'Search Engine Optimization', // SEO
  'User Experience Design', // UX
  'User Interface Design', // UI
];

export const acronymCases: Array<{ query: string; list: string[]; expected: string }> = [
  { query: 'NYC', list: places, expected: 'New York City' },
  { query: 'LA', list: places, expected: 'Los Angeles' },
  { query: 'SF', list: places, expected: 'San Francisco' },
  { query: 'LV', list: places, expected: 'Las Vegas' },
  { query: 'SLC', list: places, expected: 'Salt Lake City' },
  { query: 'HiMi', list: places, expected: 'Hillsdale Michigan' },
  { query: 'IBM', list: companies, expected: 'International Business Machines' },
  { query: 'NASA', list: companies, expected: 'National Aeronautics Space Administration' },
  { query: 'FBI', list: companies, expected: 'Federal Bureau Investigation' },
  { query: 'API', list: techTerms, expected: 'Application Programming Interface' },
  { query: 'GUI', list: techTerms, expected: 'Graphical User Interface' },
  { query: 'CLI', list: techTerms, expected: 'Command Line Interface' },
  { query: 'TDD', list: techTerms, expected: 'Test Driven Development' },
  { query: 'OOP', list: techTerms, expected: 'Object Oriented Programming' },
];
