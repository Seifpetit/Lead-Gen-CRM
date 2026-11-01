// Message templates for reaching a lead (WhatsApp first): the variables a template may hold,
// how a template is split into text and variables, and how it is filled for one lead. Pure.

/** The variables a template can hold, written {company} and so on in the stored text. */
export const TEMPLATE_VARIABLES = ['company', 'sector', 'person', 'my_name', 'my_company'] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/** The longest a template (as stored, with its {variables}) may be. */
export const MAX_TEMPLATE_LENGTH = 1000;
export const MAX_TEMPLATE_NAME_LENGTH = 80;
/** The most templates one user keeps. */
export const MAX_TEMPLATES = 30;
export const MAX_SENDER_FIELD_LENGTH = 120;

/** The languages a message template can be written in. */
export const TEMPLATE_LANGUAGES = ['fr', 'ar', 'en', 'de', 'it'] as const;
export type TemplateLanguage = (typeof TEMPLATE_LANGUAGES)[number];

export interface MessageTemplate {
  id: string;
  name: string;
  /** The language the text is written in. */
  language: TemplateLanguage;
  /** The text with its variables as {company}, {person} and so on. */
  body: string;
  updatedAt: string;
}

export interface MessageTemplateInput {
  name: string;
  /** Defaults to French when left out. */
  language?: TemplateLanguage | undefined;
  body: string;
}

/** Who the messages come from: fills {my_name} and {my_company}. Empty when not set yet. */
export interface SenderProfile {
  name: string;
  company: string;
}

export type TemplatePart =
  { kind: 'text'; text: string } | { kind: 'variable'; name: TemplateVariable };

const VARIABLE = /\{([a-z_]+)\}/g;
const isVariable = (name: string): name is TemplateVariable =>
  (TEMPLATE_VARIABLES as readonly string[]).includes(name);

/** "Bonjour {person}," as text and variables. Braces around anything else stay plain text. */
export function parseTemplate(body: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let last = 0;
  for (const match of body.matchAll(VARIABLE)) {
    const name = match[1]!;
    if (!isVariable(name)) continue;
    if (match.index > last) parts.push({ kind: 'text', text: body.slice(last, match.index) });
    parts.push({ kind: 'variable', name });
    last = match.index + match[0].length;
  }
  if (last < body.length) parts.push({ kind: 'text', text: body.slice(last) });
  return parts;
}

/** The parts written back as stored text. */
export const joinTemplate = (parts: readonly TemplatePart[]): string =>
  parts.map((p) => (p.kind === 'text' ? p.text : `{${p.name}}`)).join('');

/** One lead's values; a missing value is null or blank. */
export type TemplateValues = Partial<Record<TemplateVariable, string | null>>;

const valueOf = (values: TemplateValues, name: TemplateVariable): string | null => {
  const v = values[name]?.trim();
  return v ? v : null;
};

/** The variables of a template that have no value for this lead, each once, in order. */
export function missingVariables(body: string, values: TemplateValues): TemplateVariable[] {
  const missing: TemplateVariable[] = [];
  for (const part of parseTemplate(body)) {
    if (part.kind === 'variable' && !valueOf(values, part.name) && !missing.includes(part.name)) {
      missing.push(part.name);
    }
  }
  return missing;
}

/** The plain text that is sent: every variable replaced by its value (a missing one by nothing). */
export function fillTemplate(body: string, values: TemplateValues): string {
  return parseTemplate(body)
    .map((p) => (p.kind === 'text' ? p.text : (valueOf(values, p.name) ?? '')))
    .join('');
}

/**
 * How {sector} reads inside a French sentence ("actives dans {sector}"), per sector id. A sector
 * without an entry uses its own name.
 */
export const SECTOR_WORDING_FR: Readonly<Record<string, string>> = {
  'agri-food': "l'agroalimentaire",
  'olive-oil': "l'huile d'olive",
  'dates-produce': 'les dattes et les fruits et légumes',
  textile: "le textile et l'habillement",
  'construction-materials': 'les matériaux de construction',
  'steel-metal': "l'acier et la métallurgie",
  chemicals: 'la chimie et les engrais',
  'plastics-packaging': "le plastique, le papier et l'emballage",
  'automotive-parts': 'les composants automobiles et électriques',
  pharma: 'la pharmacie et le matériel médical',
  wholesale: 'le commerce de gros et la distribution',
  'import-export': "l'import-export",
  'retail-chains': 'la grande distribution',
  furniture: 'le meuble et le bois',
  mining: 'les mines et les carrières',
};

/** The three templates every user starts with, in French. */
export const DEFAULT_TEMPLATES: readonly MessageTemplateInput[] = [
  {
    name: 'Premier contact',
    body:
      'Bonjour {person}, je suis {my_name} de {my_company}, transporteur en Tunisie. ' +
      'Nous travaillons avec des entreprises actives dans {sector} et nous serions heureux ' +
      'de proposer nos services de transport à {company}. ' +
      'Seriez-vous disponible pour un court appel cette semaine ?',
  },
  {
    name: 'Trouver le bon contact',
    body:
      'Bonjour, je suis {my_name} de {my_company}, transporteur en Tunisie. ' +
      'Pourriez-vous m’indiquer la personne qui s’occupe du transport et de la logistique ' +
      'chez {company} ? Merci beaucoup.',
  },
  {
    name: 'Relance',
    body:
      'Bonjour {person}, je reviens vers vous au sujet du transport de vos marchandises ' +
      'pour {company}. Avez-vous des expéditions prévues prochainement ? ' +
      'Bonne journée, {my_name} ({my_company})',
  },
];

/**
 * The number WhatsApp wants ("21698123456") when a phone looks like a mobile: a Tunisian one
 * (+216 and eight digits starting with 2, 4, 5 or 9), or one written with its country code that
 * looks like a French (+33 6 or 7), German (+49 15, 16 or 17) or Italian (+39 3) mobile.
 * Landlines, special numbers and other foreign numbers give null, so they are offered as a call
 * only. These checks are hand-written, not a phone-number library: they only decide whether to
 * offer the WhatsApp button.
 */
export function whatsappNumber(raw: string | null | undefined): string | null {
  const text = raw?.trim() ?? '';
  if (text === '' || /\p{L}/u.test(text)) return null;
  let digits = text.replace(/\(0\)/g, '').replace(/[\s().\-/+]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const international = text.startsWith('+') || digits.startsWith('00');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (international) {
    if (/^33[67]\d{8}$/.test(digits)) return digits;
    if (/^491[567]\d{8,9}$/.test(digits)) return digits;
    if (/^393\d{8,9}$/.test(digits)) return digits;
  }
  if (digits.startsWith('216') && digits.length === 11) digits = digits.slice(3);
  else if (international) return null;
  if (digits.length !== 8 || !/^[2459]/.test(digits)) return null;
  return `216${digits}`;
}
