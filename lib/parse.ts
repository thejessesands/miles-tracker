import { PROGRAMS } from './programs';

export type FoundBalance = {
  program_id: string;
  balance: number;
};

export type FoundMembership = {
  program_id: string;
  membership_number: string;
};

export type DiscoveredProgram = {
  program_name: string;
  category: string;
  membership_number: string | null;
  confirmed: boolean;
};

type ProgramDefinition = {
  id: string;
  name: string;
  category: string;
  hints: RegExp;
};

const knownHints: Record<string, RegExp> = {
  united: /mileageplus|united airlines/i,
  american: /aadvantage|american airlines/i,
  delta: /skymiles|delta air lines/i,
  ba: /british airways|executive club/i,
  singapore: /krisflyer|singapore airlines/i,
  jetblue: /trueblue|jetblue/i,
  hawaiian: /hawaiianmiles|atmos rewards|hawaiian airlines/i,
  chase: /ultimate rewards|chase rewards/i,
  hyatt: /world of hyatt|hyatt/i,
  hilton: /hilton honors/i,
  ihg: /ihg one rewards|ihg rewards/i
};

const additionalPrograms: ProgramDefinition[] = [
  {
    id: 'airfrance',
    name: 'Air France/KLM Flying Blue',
    category: 'Airlines',
    hints: /flying blue/i
  },
  {
    id: 'lufthansa',
    name: 'Lufthansa Miles & More',
    category: 'Airlines',
    hints: /miles\s*&\s*more/i
  },
  {
    id: 'emirates',
    name: 'Emirates Skywards',
    category: 'Airlines',
    hints: /emirates skywards/i
  },
  {
    id: 'qatar',
    name: 'Qatar Airways Privilege Club',
    category: 'Airlines',
    hints: /qatar airways privilege club/i
  },
  {
    id: 'turkish',
    name: 'Turkish Airlines Miles&Smiles',
    category: 'Airlines',
    hints: /miles\s*&\s*smiles/i
  },
  {
    id: 'aeroplan',
    name: 'Air Canada Aeroplan',
    category: 'Airlines',
    hints: /aeroplan/i
  },
  {
    id: 'virgin',
    name: 'Virgin Atlantic Flying Club',
    category: 'Airlines',
    hints: /virgin atlantic flying club|virgin points/i
  },
  {
    id: 'southwest',
    name: 'Southwest Rapid Rewards',
    category: 'Airlines',
    hints: /southwest rapid rewards/i
  },
  {
    id: 'alaska',
    name: 'Alaska Airlines Atmos Rewards',
    category: 'Airlines',
    hints: /alaska airlines.*atmos|atmos rewards/i
  },
  {
    id: 'cathay',
    name: 'Cathay Pacific Asia Miles',
    category: 'Airlines',
    hints: /asia miles|cathay membership/i
  },
  {
    id: 'qantas',
    name: 'Qantas Frequent Flyer',
    category: 'Airlines',
    hints: /qantas frequent flyer/i
  },
  {
    id: 'ana',
    name: 'ANA Mileage Club',
    category: 'Airlines',
    hints: /ana mileage club/i
  },
  {
    id: 'jal',
    name: 'Japan Airlines Mileage Bank',
    category: 'Airlines',
    hints: /jal mileage bank|jmb membership/i
  },
  {
    id: 'marriott',
    name: 'Marriott Bonvoy',
    category: 'Hotels',
    hints: /marriott bonvoy/i
  },
  {
    id: 'wyndham',
    name: 'Wyndham Rewards',
    category: 'Hotels',
    hints: /wyndham rewards/i
  },
  {
    id: 'choice',
    name: 'Choice Privileges',
    category: 'Hotels',
    hints: /choice privileges/i
  },
  {
    id: 'accor',
    name: 'ALL Accor Live Limitless',
    category: 'Hotels',
    hints: /accor live limitless|all accor/i
  },
  {
    id: 'radisson',
    name: 'Radisson Rewards',
    category: 'Hotels',
    hints: /radisson rewards/i
  },
  {
    id: 'bestwestern',
    name: 'Best Western Rewards',
    category: 'Hotels',
    hints: /best western rewards/i
  }
];

const balancePatterns = [
  /(?:available|current|total|ending|new|your)\s+(?:rewards?\s+)?(?:points?|miles?|avios)?\s*balance\s*(?:is|:|of)?\s*([\d,]{1,15})\s*(?:points?|miles?|avios)?/gi,
  /(?:points?|miles?|avios)\s+(?:available|balance)\s*(?:is|:|of)?\s*([\d,]{1,15})/gi,
  /balance\s*(?:is|:|of)\s*([\d,]{1,15})\s*(?:points?|miles?|avios)/gi
];

const membershipPatterns = [
  /\b(?:membership|member|loyalty|frequent\s*flyer|frequent\s*guest)\s*(?:number|no\.?|#|id)\s*[:#-]?\s*([A-Z0-9][A-Z0-9 -]{3,23})/gi,
  /\b(?:account)\s*(?:number|no\.?|#)\s*[:#-]\s*([A-Z0-9][A-Z0-9 -]{3,23})/gi
];

function cleanText(subject: string, body: string): string {
  return (subject + ' ' + body)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .slice(0, 150000);
}

function extractNumber(text: string): string | null {
  const candidates = new Set<string>();

  for (const pattern of membershipPatterns) {
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const raw = match[1].trim();

      // Stop at the first whitespace-separated token.
      const value = raw.split(/\s+/)[0].replace(/[^A-Z0-9]/gi, '');

      if (value.length < 5 || value.length > 20) continue;

      // Exclude ordinary words and dates.
      if (!/\d/.test(value)) continue;

      if (/^(19|20)\d{6}$/.test(value)) continue;

      candidates.add(value);
    }
  }

  // Never guess if different account numbers appear.
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function extractBalances(
  subject: string,
  body: string
): FoundBalance[] {
  const text = cleanText(subject, body);
  const out: FoundBalance[] = [];

  for (const p of PROGRAMS) {
    const hint = knownHints[p.id];

    if (!hint || !hint.test(text)) continue;

    const found = new Set<number>();

    for (const pattern of balancePatterns) {
      pattern.lastIndex = 0;

      let match: RegExpExecArray | null;

      while ((match = pattern.exec(text)) !== null) {
        const n = Number(match[1].replace(/,/g, ''));

        if (Number.isSafeInteger(n) && n >= 0) {
          found.add(n);
        }
      }
    }

    if (found.size === 1) {
      out.push({
        program_id: p.id,
        balance: [...found][0]
      });
    }
  }

  return out;
}

export function extractMemberships(
  subject: string,
  body: string
): FoundMembership[] {
  const text = cleanText(subject, body);
  const number = extractNumber(text);

  if (!number) return [];

  const matchingPrograms = PROGRAMS.filter(
    p => knownHints[p.id]?.test(text)
  );

  // Avoid assigning a number to the wrong program.
  if (matchingPrograms.length !== 1) return [];

  return [{
    program_id: matchingPrograms[0].id,
    membership_number: number
  }];
}

export function hasAccountActivity(subject: string, body: string): boolean {
 const text = cleanText(subject, body);
 const promotional = /\b(unsubscribe|limited.time offer|shop now|special offer|earn bonus points|exclusive deal)\b/i.test(subject);
 const accountSpecific = /\b(your (?:current |available |new |ending )?(?:points|miles|avios)? ?balance|account statement|monthly statement|points earned|miles earned|points redeemed|miles redeemed|redemption confirmation|membership number|member number|member id|frequent flyer number|account activity|transaction history)\b/i.test(text);
 return accountSpecific && !(promotional && !/\b(account statement|transaction history|points redeemed|miles redeemed)\b/i.test(subject));
}

export function discoverPrograms(
  subject: string,
  body: string
): DiscoveredProgram[] {
  const text = cleanText(subject, body);
  const found: DiscoveredProgram[] = [];

  const membershipNumber = extractNumber(text);

  const membershipEvidence =
    /\b(welcome to|your membership|member number|membership number|member id|loyalty account|your account statement|points balance|miles balance)\b/i.test(text);

  const matches = additionalPrograms.filter(program => program.hints.test(text));
  for (const program of matches) {

    found.push({
      program_name: program.name,
      category: program.category,
      membership_number: matches.length === 1 ? membershipNumber : null,
      confirmed: false
    });
  }

  // The caller can use membershipEvidence to prioritize
  // stronger evidence over promotional messages.
  return found.map(p => ({
    ...p,
    membership_number: membershipEvidence
      ? p.membership_number
      : null
  }));
}

export function decodeBase64Url(data: string): string {
  return Buffer.from(
    data.replace(/-/g, '+').replace(/_/g, '/'),
    'base64'
  ).toString('utf8');
}

export function collectParts(payload: any): string {
  let s = '';

  if (payload?.body?.data) {
    s += decodeBase64Url(payload.body.data) + ' ';
  }

  for (const part of payload?.parts || []) {
    s += collectParts(part);
  }

  return s;
}
