// Offline boundary for the public parser library. Supply fixture text to the pure parsers.
export const cik10 = value => String(value).padStart(10,'0');
export const TTL = {submissions:86400000,text:86400000};
export async function getText() { throw new Error('Use local fixture text in the public edition.'); }
export async function getJSON() { throw new Error('Use local fixture objects in the public edition.'); }
export async function companySubmissions() { return {filings:{recent:{form:[],filingDate:[],accessionNumber:[],primaryDocument:[]}}}; }
