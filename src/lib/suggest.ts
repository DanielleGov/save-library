import { normalize, tokenize } from './text';
import type { Bookmark, Category } from './types';
import { textWithoutUrls } from './url';

/**
 * Small on-device keyword matcher. Each concept has English + Hebrew display names and keywords.
 * User categories are matched by their own name words, and by a concept when their name matches it.
 */
interface Concept {
  en: string;
  he: string;
  keywords: string[];
}

export const CONCEPTS: Concept[] = [
  {
    en: 'Sewing',
    he: 'תפירה',
    keywords: [
      'sew', 'sewing', 'seam', 'stitch', 'stitching', 'fabric', 'quilt', 'quilting', 'embroidery', 'hem',
      'pattern', 'patterns', 'serger', 'overlock', 'tailoring', 'thread', 'zipper', 'dressmaking', 'diy dress',
      'תפירה', 'לתפור', 'תופרת', 'בד', 'בדים', 'גזרה', 'גזרות', 'רקמה', 'מכונת תפירה', 'טלאים', 'אוברלוק', 'חוט',
    ],
  },
  {
    en: 'Recipes',
    he: 'מתכונים',
    keywords: [
      'recipe', 'recipes', 'cook', 'cooking', 'bake', 'baking', 'baked', 'dinner', 'lunch', 'breakfast',
      'dessert', 'cake', 'cookies', 'bread', 'pasta', 'soup', 'salad', 'chicken', 'ingredients', 'oven',
      'vegan', 'airfryer', 'air fryer', 'foodie', 'kitchen',
      'מתכון', 'מתכונים', 'בישול', 'אפייה', 'אפיה', 'עוגה', 'עוגיות', 'ארוחה', 'ארוחת', 'לחם', 'מרק', 'סלט',
      'עוף', 'תנור', 'קינוח', 'פסטה', 'מטבח', 'חלה',
    ],
  },
  {
    en: 'Home & Decor',
    he: 'בית ועיצוב',
    keywords: [
      'decor', 'interior', 'home', 'livingroom', 'living room', 'bedroom', 'organizing', 'organization',
      'cleaning', 'furniture', 'renovation', 'garden', 'plants',
      'עיצוב', 'בית', 'סלון', 'חדר', 'ארגון', 'ניקיון', 'רהיטים', 'שיפוץ', 'גינה', 'צמחים',
    ],
  },
  {
    en: 'Fitness',
    he: 'כושר',
    keywords: [
      'workout', 'fitness', 'exercise', 'yoga', 'pilates', 'gym', 'stretch', 'stretching', 'abs', 'running',
      'אימון', 'כושר', 'יוגה', 'פילאטיס', 'מתיחות', 'ריצה', 'חדר כושר',
    ],
  },
  {
    en: 'Crafts',
    he: 'יצירה',
    keywords: [
      'craft', 'crafts', 'crochet', 'knit', 'knitting', 'diy', 'handmade', 'macrame', 'yarn', 'painting',
      'סריגה', 'יצירה', 'עבודת יד', 'מקרמה', 'צמר', 'ציור',
    ],
  },
  {
    en: 'Travel',
    he: 'טיולים',
    keywords: ['travel', 'trip', 'hotel', 'vacation', 'itinerary', 'beach', 'טיול', 'טיולים', 'מלון', 'חופשה', 'נופש'],
  },
];

export type Suggestion =
  | { kind: 'existing'; categoryId: string; name: string; score: number }
  | { kind: 'new'; name: string; score: number };

const HEB_PREFIXES = ['ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ'];

/** Token variants: the token, Hebrew prefix-stripped forms, and simple English plural/-ing stems. */
function variants(tok: string): string[] {
  const out = [tok];
  if (/[\u0590-\u05ff]/.test(tok)) {
    let t = tok;
    for (let i = 0; i < 2 && t.length > 3 && HEB_PREFIXES.includes(t[0]!); i++) {
      t = t.slice(1);
      out.push(t);
    }
  } else {
    if (tok.length > 4 && tok.endsWith('s')) out.push(tok.slice(0, -1));
    if (tok.length > 5 && tok.endsWith('ing')) out.push(tok.slice(0, -3));
  }
  return out;
}

function matchCount(textTokens: string[], textNorm: string, keywords: string[]): number {
  const tokenSet = new Set(textTokens.flatMap(variants));
  let n = 0;
  for (const kw of keywords) {
    const k = normalize(kw);
    if (!k) continue;
    if (k.includes(' ') ? ` ${textNorm} `.includes(` ${k} `) : tokenSet.has(k)) n++;
  }
  return n;
}

type SuggestFields = Pick<Bookmark, 'title' | 'sharedText' | 'note' | 'tags'> & Partial<Pick<Bookmark, 'autoTitle' | 'screenText'>>;

export function suggestionText(b: SuggestFields): string {
  return [b.title, b.sharedText ? textWithoutUrls(b.sharedText) : '', b.screenText, b.note, b.tags.join(' ')]
    .filter(Boolean)
    .join(' ');
}

const STOP = new Set(['and', 'the', 'my', 'of', 'for', 'to', 'a', 'ideas', 'stuff', 'של', 'את', 'ו']);

export function suggestCategory(
  b: SuggestFields,
  categories: Category[],
): Suggestion | null {
  const text = suggestionText(b);
  const textNorm = normalize(text.replace(/#/g, ' '));
  const tokens = tokenize(text);
  if (tokens.length === 0) return null; // opaque link: stay in Inbox

  let best: Suggestion | null = null;
  for (const c of categories) {
    const nameTokens = tokenize(c.name).filter((t) => !STOP.has(t) && t.length > 1);
    const nameKw = nameTokens.flatMap(variants);
    let score = matchCount(tokens, textNorm, nameKw) * 2;
    for (const concept of CONCEPTS) {
      const conceptNames = [concept.en, concept.he].map(normalize);
      const nameNorm = normalize(c.name);
      const linked =
        conceptNames.some((n) => n === nameNorm || nameNorm.includes(n)) ||
        nameTokens.some((t) => concept.keywords.map(normalize).includes(t));
      if (linked) score += matchCount(tokens, textNorm, concept.keywords);
    }
    if (score > 0 && (!best || score > best.score)) best = { kind: 'existing', categoryId: c.id, name: c.name, score };
  }
  if (best) return best;

  const hebrew = (text.match(/[\u0590-\u05ff]/g) ?? []).length > (text.match(/[a-z]/gi) ?? []).length;
  let bestNew: Suggestion | null = null;
  for (const concept of CONCEPTS) {
    const score = matchCount(tokens, textNorm, concept.keywords);
    if (score > 0 && (!bestNew || score > bestNew.score)) {
      bestNew = { kind: 'new', name: hebrew ? concept.he : concept.en, score };
    }
  }
  // avoid suggesting to create a category that already exists by name
  if (bestNew && categories.some((c) => normalize(c.name) === normalize(bestNew!.name))) return null;
  return bestNew;
}
