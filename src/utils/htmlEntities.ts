/**
 * Shared text, HTML entity decoding, Russian pluralization, and timezone utilities.
 */

const NAMED_HTML_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: '&',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
};

/**
 * Fully decodes named, decimal (e.g. &#34;, &#8217;), and hex (e.g. &#x27;) HTML entities.
 * Runs twice to safely handle double-encoded RSS feeds (e.g. &amp;#34;).
 */
export function decodeHtmlEntities(input: string): string {
  if (!input) return '';
  const decodeOnce = (str: string) =>
    str.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
      if (entity.startsWith('#x') || entity.startsWith('#X')) {
        const code = parseInt(entity.slice(2), 16);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      if (entity.startsWith('#')) {
        const code = parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      const mapped = NAMED_HTML_ENTITIES[entity.toLowerCase()];
      return mapped !== undefined ? mapped : match;
    });

  return decodeOnce(decodeOnce(input)).replace(/\s+/g, ' ').trim();
}

/**
 * Correct Russian plural form: pluralRu(1, ['пара', 'пары', 'пар']) -> '1 пара'
 */
export function pluralRu(count: number, forms: [string, string, string]): string {
  const abs = Math.abs(Math.trunc(count));
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 19) return `${count} ${forms[2]}`;
  if (mod10 === 1) return `${count} ${forms[0]}`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} ${forms[1]}`;
  return `${count} ${forms[2]}`;
}

/**
 * Converts a calendar event's UTC date & time labels (e.g. '2026-11-19' / '19 ноя' + '13:30 UTC')
 * into the user's device local timezone using Intl.DateTimeFormat, e.g. '15:30 (лок.)'.
 */
export function formatEventTimeToLocal(
  dateLabel: string,
  timeUtcLabel: string,
  lang: 'ru' | 'en' = 'ru'
): { localTimeLabel: string; shiftedDateLabel?: string } {
  const raw = (timeUtcLabel || '').trim();
  const timeMatch = raw.match(/(\d{1,2}):(\d{2})/);
  if (!timeMatch) {
    return { localTimeLabel: raw || (lang === 'en' ? 'All day' : 'Весь день') };
  }
  const hh = Number(timeMatch[1]);
  const mm = Number(timeMatch[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 23 || mm > 59) {
    return { localTimeLabel: raw };
  }

  // Try parsing ISO date (YYYY-MM-DD) or Russian/English month date, else use today UTC
  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  let day = now.getUTCDate();

  const isoMatch = (dateLabel || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  const dotMatch = (dateLabel || '').match(/(\d{1,2})\.(\d{2})(?:\.(\d{2,4}))?/);
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]) - 1;
    day = Number(isoMatch[3]);
  } else if (dotMatch) {
    day = Number(dotMatch[1]);
    month = Number(dotMatch[2]) - 1;
    if (dotMatch[3]) {
      year = dotMatch[3].length === 2 ? 2000 + Number(dotMatch[3]) : Number(dotMatch[3]);
    }
  }

  const utcDate = new Date(Date.UTC(year, month, day, hh, mm, 0));
  if (Number.isNaN(utcDate.getTime())) {
    return { localTimeLabel: raw };
  }

  try {
    const formatted = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(utcDate);
    const suffix = lang === 'en' ? '(local)' : '(лок.)';
    return { localTimeLabel: `${formatted} ${suffix}` };
  } catch {
    return { localTimeLabel: raw };
  }
}
