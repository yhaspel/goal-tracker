/**
 * Verifies the three interface dictionaries against the English source.
 *
 *   node scripts/check-i18n.ts
 *
 * English is only a development fallback. This check is what stops a missing Hebrew or
 * Russian key from quietly rendering English in a release, and what catches a mistyped
 * placeholder that would otherwise be shown to a member verbatim.
 */
// The dictionary modules are imported directly rather than through `translate.ts`, whose own
// imports are extensionless for the bundler. `tests/web.ui.test.ts` asserts that the registry
// in `translate.ts` holds exactly these three, so the two cannot drift apart.
import { LOCALES, type Locale } from '../shared/api.ts';
import { en } from '../web/src/i18n/en.ts';
import { he } from '../web/src/i18n/he.ts';
import { ru } from '../web/src/i18n/ru.ts';

const DICTIONARIES: Record<string, Record<string, string>> = {
  en: en as unknown as Record<string, string>,
  he: he as unknown as Record<string, string>,
  ru: ru as unknown as Record<string, string>
};

const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

function splitPlural(key: string): { base: string; category: PluralCategory } | null {
  const index = key.lastIndexOf('.');
  if (index < 0) return null;
  const category = key.slice(index + 1);
  return (PLURAL_CATEGORIES as readonly string[]).includes(category)
    ? { base: key.slice(0, index), category: category as PluralCategory }
    : null;
}

function placeholders(template: string): Set<string> {
  return new Set([...template.matchAll(/\{(\w+)\}/g)].map(match => match[1]!));
}

const problems: string[] = [];
const englishKeys = Object.keys(en);
const pluralBases = new Set(
  englishKeys.map(key => splitPlural(key)?.base).filter((base): base is string => base !== undefined)
);
const plainKeys = englishKeys.filter(key => splitPlural(key) === null);

for (const locale of LOCALES) {
  const dictionary = DICTIONARIES[locale as Locale] as Record<string, string | undefined> | undefined;
  if (!dictionary) {
    problems.push(`${locale}: no dictionary is registered`);
    continue;
  }

  for (const key of plainKeys) {
    const translated = dictionary[key];
    if (translated === undefined) {
      problems.push(`${locale}: missing key ${key}`);
      continue;
    }
    if (translated.trim().length === 0) {
      problems.push(`${locale}: ${key} is empty`);
      continue;
    }
    // A plain key must use exactly the English placeholders. Dropping one would silently
    // lose a name or a count; adding one would render literal braces.
    const expected = placeholders(en[key as keyof typeof en]);
    const actual = placeholders(translated);
    const missing = [...expected].filter(name => !actual.has(name));
    const extra = [...actual].filter(name => !expected.has(name));
    if (missing.length > 0) problems.push(`${locale}: ${key} drops {${missing.join('}, {')}}`);
    if (extra.length > 0) problems.push(`${locale}: ${key} adds unknown {${extra.join('}, {')}}`);
  }

  // Plural categories differ by language, so each locale must cover exactly its own.
  const required = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  for (const base of pluralBases) {
    for (const category of required) {
      const translated = dictionary[`${base}.${category}`];
      if (translated === undefined || translated.trim().length === 0) {
        problems.push(`${locale}: missing plural form ${base}.${category}`);
        continue;
      }
      // A plural form may naturally omit the count, as Hebrew does for "one card", but it
      // must never introduce a placeholder the English family does not provide.
      const reference = en[`${base}.${category}` as keyof typeof en] ?? en[`${base}.other` as keyof typeof en];
      const expected = placeholders(String(reference ?? ''));
      const extra = [...placeholders(translated)].filter(name => name !== 'count' && !expected.has(name));
      if (extra.length > 0) problems.push(`${locale}: ${base}.${category} adds unknown {${extra.join('}, {')}}`);
    }
  }

  for (const key of Object.keys(dictionary)) {
    const plural = splitPlural(key);
    if (plural === null) {
      if (!(key in en)) problems.push(`${locale}: unknown key ${key}`);
    } else if (!pluralBases.has(plural.base)) {
      problems.push(`${locale}: unknown plural family ${plural.base}`);
    } else if (!required.includes(plural.category)) {
      problems.push(`${locale}: ${key} is not a plural category this language uses`);
    }
  }
}

if (problems.length > 0) {
  console.error(`${problems.length} dictionary problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(
  `Checked ${LOCALES.length} locales against ${englishKeys.length} English keys ` +
    `(${pluralBases.size} plural famil${pluralBases.size === 1 ? 'y' : 'ies'}); all complete.`
);
