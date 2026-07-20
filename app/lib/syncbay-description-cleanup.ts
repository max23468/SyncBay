export const SYNCBAY_CLEAN_DESCRIPTION_MODE = "HTML pulito senza template e colori";

export interface DescriptionCleanupReportRow {
  cleanedLength: number;
  cleanedTextExcerpt: string;
  itemId: string;
  rawLength: number;
  rawTextExcerpt: string;
  removedPercent: number;
  templateSignalCount: number;
  title: string;
  wasChanged: boolean;
}

export interface DescriptionCleanupReportSummary {
  averageRemovedPercent: number;
  changedCount: number;
  maxRemovedPercent: number;
  sampledCount: number;
  templateSignalCount: number;
}

const UNSAFE_BLOCK_TAGS = [
  "base",
  "button",
  "canvas",
  "embed",
  "form",
  "iframe",
  "input",
  "link",
  "meta",
  "noscript",
  "object",
  "script",
  "select",
  "style",
  "svg",
  "textarea",
];

const TEMPLATE_BLOCK_TAGS = ["aside", "footer", "header", "nav", "section", "table"];

const ALLOWED_TAGS = new Set([
  "b",
  "br",
  "em",
  "h2",
  "h3",
  "h4",
  "i",
  "li",
  "ol",
  "p",
  "strong",
  "u",
  "ul",
]);

const STRONG_TEMPLATE_PHRASES = [
  /\baggiungi(?:ci)? ai preferiti\b/i,
  /\baltri (?:nostri )?(?:oggetti|articoli|annunci) in vendita\b/i,
  /\bebay store\b/i,
  /\bfeedback\b/i,
  /\biscriviti alla newsletter\b/i,
  /\bnegozio ebay\b/i,
  /\bpotrebbe(?:ro)? (?:anche )?interessart[ie]\b/i,
  /\bpowered by\b/i,
  /\bpromozioni\b/i,
  /\bseguici su\b/i,
  /\btemplate\b/i,
  /\bvisita il nostro negozio\b/i,
  /\bvisita lo store\b/i,
];

const TEMPLATE_TAIL_MARKERS = [
  /\bvisita il nostro sito\b/i,
  /\bvisitate il nostro sito\b/i,
  /\bmetodi di pagamento\b/i,
  /\bmetodi di spedizione\b/i,
  /\bdiritto di recesso\b/i,
  /\bcondizioni di vendita\b/i,
  /\binformativa sulla privacy\b/i,
  /\brilascio feedback\b/i,
  /\bpagamenti sicuri\b/i,
  /\bspedizioni rapide\b/i,
  /\breso facile\b/i,
  /\bservizio clienti\b/i,
  /\bpotrebbe(?:ro)? (?:anche )?interessart[ie]\b/i,
  /\bseguici su\b/i,
  /\btutti i diritti riservati\b/i,
  /\bpartita iva\b/i,
  /\bp\.\s?iva\b/i,
];

const TEMPLATE_SIGNAL_PATTERNS = [
  ...STRONG_TEMPLATE_PHRASES,
  ...TEMPLATE_TAIL_MARKERS,
  /\bmetodi di spedizione\b/i,
  /\bvisita il negozio\b/i,
];

const TEMPLATE_KEYWORDS = [
  /\bchi siamo\b/i,
  /\bcondizioni\b/i,
  /\bcontattaci\b/i,
  /\bcontatti\b/i,
  /\bgaranzia\b/i,
  /\bmetodi di pagamento\b/i,
  /\bpagamenti\b/i,
  /\bprivacy\b/i,
  /\bres[io]\b/i,
  /\brestituzion[ei]\b/i,
  /\bspedizion[ei]\b/i,
];

const LEADING_TEMPLATE_SEPARATOR = String.raw`(?:\s|&nbsp;|&#160;|<br>)+`;

const LEADING_TEMPLATE_PHRASES = [
  new RegExp(
    String.raw`CON${LEADING_TEMPLATE_SEPARATOR}LA${LEADING_TEMPLATE_SEPARATOR}GARANZIA${LEADING_TEMPLATE_SEPARATOR}DI${LEADING_TEMPLATE_SEPARATOR}UN${LEADING_TEMPLATE_SEPARATOR}PERITO${LEADING_TEMPLATE_SEPARATOR}NUMISMATICO${LEADING_TEMPLATE_SEPARATOR}PROFESSIONISTA`,
    "i",
  ),
  new RegExp(
    String.raw`TUTELATE${LEADING_TEMPLATE_SEPARATOR}I${LEADING_TEMPLATE_SEPARATOR}VOSTRI${LEADING_TEMPLATE_SEPARATOR}ACQUISTI!?`,
    "i",
  ),
  new RegExp(
    String.raw`ACQUISTATE${LEADING_TEMPLATE_SEPARATOR}DA${LEADING_TEMPLATE_SEPARATOR}VENDITORI${LEADING_TEMPLATE_SEPARATOR}SERI${LEADING_TEMPLATE_SEPARATOR}E${LEADING_TEMPLATE_SEPARATOR}PROFESSIONALI!?`,
    "i",
  ),
];

export function cleanEbayDescriptionHtml(descriptionHtml: string | null | undefined) {
  const original = normalizeInputDescription(descriptionHtml);

  if (!original) {
    return {
      html: null,
      mode: SYNCBAY_CLEAN_DESCRIPTION_MODE,
      wasChanged: false,
    };
  }

  let html = original;

  html = removeComments(html);
  html = removeUnsafeBlocks(html);
  html = removeTemplateBlocks(html);
  html = stripAttributes(html);
  html = unwrapUnsupportedTags(html);
  html = normalizeDescriptionWhitespace(html);
  html = removeLeadingTemplatePhrases(html);
  html = removeTemplateNavigationLists(html);
  html = removeLeadingTemplatePhrases(html);
  html = truncateTemplateTail(html);
  html = normalizeDescriptionWhitespace(html);
  html = removeLeadingTemplateTextPrefix(html);
  html = normalizeDescriptionWhitespace(html);
  html = removeUnmatchedTrailingParagraphClosers(html);

  return {
    html: html || null,
    mode: SYNCBAY_CLEAN_DESCRIPTION_MODE,
    wasChanged: html !== original,
  };
}

export function buildDescriptionCleanupReportRow(input: {
  descriptionHtml: string | null | undefined;
  itemId: string;
  title: string | null | undefined;
}): DescriptionCleanupReportRow {
  const rawHtml = input.descriptionHtml?.trim() ?? "";
  const cleaned = cleanEbayDescriptionHtml(rawHtml);
  const cleanedHtml = cleaned.html ?? "";
  const rawLength = rawHtml.length;
  const cleanedLength = cleanedHtml.length;
  const rawText = htmlToText(rawHtml);
  const cleanedText = htmlToText(cleanedHtml);

  return {
    cleanedLength,
    cleanedTextExcerpt: excerpt(cleanedText),
    itemId: input.itemId,
    rawLength,
    rawTextExcerpt: excerpt(getSafeRawTextExcerpt(rawText, cleanedText)),
    removedPercent: rawLength
      ? Math.max(0, Math.round(((rawLength - cleanedLength) / rawLength) * 100))
      : 0,
    templateSignalCount: countTemplateSignals(rawText),
    title: normalizeTitle(input.title, input.itemId),
    wasChanged: cleaned.wasChanged,
  };
}

export function summarizeDescriptionCleanupReport(
  rows: DescriptionCleanupReportRow[],
): DescriptionCleanupReportSummary {
  const sampledCount = rows.length;
  const totalRemovedPercent = rows.reduce((total, row) => total + row.removedPercent, 0);

  return {
    averageRemovedPercent: sampledCount ? Math.round(totalRemovedPercent / sampledCount) : 0,
    changedCount: rows.filter((row) => row.wasChanged).length,
    maxRemovedPercent: rows.reduce((max, row) => Math.max(max, row.removedPercent), 0),
    sampledCount,
    templateSignalCount: rows.reduce((total, row) => total + row.templateSignalCount, 0),
  };
}

function htmlToText(html: string) {
  // `&amp;` per ultimo: decodificarlo prima degli altri renderebbe un
  // `&amp;quot;` gia' escapato in `&quot;` e poi in `"` (doppio unescape).
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function removeUnmatchedTrailingParagraphClosers(html: string) {
  let current = html;

  while (countTag(current, "p") < countClosingTag(current, "p")) {
    const next = current.replace(/<\/p>\s*$/i, "");
    if (next === current) break;
    current = next;
  }

  return current;
}

function countTag(html: string, tagName: string) {
  return Array.from(html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "gi"))).length;
}

function countClosingTag(html: string, tagName: string) {
  return Array.from(html.matchAll(new RegExp(`</${tagName}>`, "gi"))).length;
}

function removeLeadingTemplatePhrases(html: string) {
  let current = html;
  let previous = "";

  while (current !== previous) {
    previous = current;

    for (const phrase of LEADING_TEMPLATE_PHRASES) {
      current = removeLeadingTemplatePhrase(current, phrase);
    }
  }

  return current;
}

function removeLeadingTemplatePhrase(html: string, phrase: RegExp) {
  const leadingMarkup = String.raw`(?:(?:<br>|</?p>|</?strong>|</?b>|</?em>|</?i>|</?u>)|\s|&nbsp;|&#160;|[!.,:;\-|])*`;
  const pattern = new RegExp(
    `^${leadingMarkup}${phrase.source}(?:\\s|&nbsp;|&#160;|<br>|</?p>|</?strong>|</?b>|</?em>|</?i>|</?u>|[!.,:;\\-|])*`,
    "i",
  );

  return html.replace(pattern, "");
}

function removeLeadingTemplateTextPrefix(html: string) {
  const text = htmlToText(html);
  let current = text;
  let previous = "";

  while (current !== previous) {
    previous = current;

    for (const phrase of LEADING_TEMPLATE_PHRASES) {
      const pattern = new RegExp(`^${phrase.source}(?:\\s|&nbsp;|&#160;|[!.,:;\\-|])*`, "i");
      current = current.replace(pattern, "").trimStart();
    }
  }

  if (current === text) return html;
  if (!current) return "";

  return `<p>${escapeHtml(current)}</p>`;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function removeTemplateNavigationLists(html: string) {
  return html.replace(/<ul>[\s\S]*?<\/ul>/gi, (block) =>
    shouldDropTemplateBlock(block) ? "" : block,
  );
}

function truncateTemplateTail(html: string) {
  const text = stripTags(html).replace(/\s+/g, " ").trim();
  if (!text) return html;

  const markerIndices: number[] = [];
  for (const pattern of TEMPLATE_TAIL_MARKERS) {
    const match = pattern.exec(text);
    if (match && match.index >= 0) markerIndices.push(match.index);
  }
  const marker = markerIndices.length > 0 ? Math.min(...markerIndices) : undefined;

  if (marker === undefined || marker < 15) return html;

  return truncateHtmlByTextIndex(html, marker);
}

function truncateHtmlByTextIndex(html: string, maxTextIndex: number) {
  let textIndex = 0;
  let output = "";
  let cursor = 0;

  for (const match of html.matchAll(/<[^>]+>/g)) {
    const tagStart = match.index ?? 0;
    const textChunk = html.slice(cursor, tagStart);
    const nextTextIndex = textIndex + textChunk.length;

    if (nextTextIndex >= maxTextIndex) {
      output += textChunk.slice(0, maxTextIndex - textIndex);
      return closeOpenTags(trimTrailingPartialBlock(output));
    }

    output += textChunk;
    textIndex = nextTextIndex;
    output += match[0];
    cursor = tagStart + match[0].length;
  }

  const tail = html.slice(cursor);
  output += tail.slice(0, Math.max(0, maxTextIndex - textIndex));

  return closeOpenTags(trimTrailingPartialBlock(output));
}

function closeOpenTags(html: string) {
  const openTags: string[] = [];

  for (const match of html.matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi)) {
    const tag = match[0];
    const tagName = String(match[1]).toLowerCase();

    if (tagName === "br") continue;

    if (tag.startsWith("</")) {
      const index = openTags.lastIndexOf(tagName);
      if (index >= 0) openTags.splice(index, 1);
      continue;
    }

    openTags.push(tagName);
  }

  return `${html.trim()}${openTags
    .reverse()
    .map((tagName) => `</${tagName}>`)
    .join("")}`;
}

function trimTrailingPartialBlock(html: string) {
  const lastBlockStart = html.search(/<(p|li|h2|h3|h4)>[^<]*$/i);
  if (lastBlockStart === -1) return html;

  return html.slice(0, lastBlockStart);
}

function normalizeInputDescription(value: string | null | undefined) {
  const normalized = value?.replace(/&nbsp;|&#160;/gi, " ").trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function removeComments(html: string) {
  // Un solo passaggio e' incompleto: rimuovere un commento puo' ricomporne un
  // altro (es. `<!--a<!--b-->-->`), quindi si itera fino a stabilita'.
  let current = html;
  let previous = "";

  while (current !== previous) {
    previous = current;
    current = current.replace(/<!--[\s\S]*?-->/g, "");
  }

  return current;
}

function removeUnsafeBlocks(html: string) {
  return UNSAFE_BLOCK_TAGS.reduce((current, tagName) => {
    const pairedTag = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, "gi");
    const standaloneTag = new RegExp(`<${tagName}\\b[^>]*\\/?>`, "gi");

    return current.replace(pairedTag, "").replace(standaloneTag, "");
  }, html);
}

function removeTemplateBlocks(html: string) {
  return TEMPLATE_BLOCK_TAGS.reduce(
    (current, tagName) => removeBlocksByTagName(current, tagName),
    html,
  );
}

function removeBlocksByTagName(html: string, tagName: string) {
  const blockPattern = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, "gi");

  return html.replace(blockPattern, (block) => (shouldDropTemplateBlock(block) ? "" : block));
}

function shouldDropTemplateBlock(blockHtml: string) {
  const text = stripTags(blockHtml).replace(/\s+/g, " ").trim();

  if (!text) return true;

  if (STRONG_TEMPLATE_PHRASES.some((pattern) => pattern.test(text))) {
    return true;
  }

  const matchedKeywords = TEMPLATE_KEYWORDS.filter((pattern) => pattern.test(text)).length;

  return matchedKeywords >= 2 && text.length >= 40;
}

function stripAttributes(html: string) {
  return html.replace(/<([a-z][a-z0-9]*)\b[^>]*>/gi, (_match, tagName) => {
    const normalizedTagName = String(tagName).toLowerCase();

    if (!ALLOWED_TAGS.has(normalizedTagName)) {
      return `<${normalizedTagName}>`;
    }

    return normalizedTagName === "br" ? "<br>" : `<${normalizedTagName}>`;
  });
}

function unwrapUnsupportedTags(html: string) {
  return html.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (tag, tagName) => {
    const normalizedTagName = String(tagName).toLowerCase();

    if (!ALLOWED_TAGS.has(normalizedTagName)) {
      return " ";
    }

    return tag.startsWith("</")
      ? `</${normalizedTagName}>`
      : normalizedTagName === "br"
        ? "<br>"
        : `<${normalizedTagName}>`;
  });
}

function normalizeDescriptionWhitespace(html: string) {
  const normalized = html
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .replace(/<(p|li|h2|h3|h4)>\s+/gi, "<$1>")
    .replace(/\s+<\/(p|li|h2|h3|h4)>/gi, "</$1>")
    .replace(/(?:<br>){3,}/gi, "<br><br>")
    .replace(/<p>(?:<br>|\s)*<\/p>/gi, "")
    .replace(/<p>\s*<\/p>/gi, "")
    .replace(/<\/p><\/p>/gi, "</p>")
    .replace(/(?:<\/p>)+$/gi, "</p>")
    .trim();

  const withoutEmptyTags = removeEmptyFormattingTags(normalized);
  const formatted = formatLeadingFormattingFragments(withoutEmptyTags);

  if (!formatted) return "";
  if (/<[a-z][a-z0-9]*(?:\s|>)/i.test(formatted)) return formatted;

  return `<p>${formatted}</p>`;
}

function stripTags(html: string) {
  return html.replace(/<[^>]+>/g, " ");
}

function getSafeRawTextExcerpt(rawText: string, cleanedText: string) {
  if (!rawText) return "";
  if (cleanedText) return cleanedText;

  const signalIndices: number[] = [];
  for (const pattern of TEMPLATE_SIGNAL_PATTERNS) {
    const match = pattern.exec(rawText);
    if (match && match.index >= 0) signalIndices.push(match.index);
  }
  const firstTemplateSignalIndex =
    signalIndices.length > 0 ? Math.min(...signalIndices) : undefined;

  if (firstTemplateSignalIndex === undefined) return rawText;

  return rawText.slice(0, firstTemplateSignalIndex).trim();
}

function countTemplateSignals(text: string) {
  return TEMPLATE_SIGNAL_PATTERNS.filter((pattern) => pattern.test(text)).length;
}

function excerpt(text: string, maxLength = 220) {
  const normalized = text.replace(/\s+/g, " ").trim();

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function normalizeTitle(value: string | null | undefined, itemId: string) {
  const normalized = value?.trim();

  return normalized && normalized.length > 0 ? normalized : `Listing eBay ${itemId}`;
}

function removeEmptyFormattingTags(html: string) {
  let current = html;
  let previous = "";

  while (current !== previous) {
    previous = current;
    current = current.replace(/<(b|em|i|strong|u)>\s*<\/\1>/gi, "");
  }

  return current.trim();
}

function formatLeadingFormattingFragments(html: string) {
  const firstBlockIndex = html.search(/<(p|ul|ol|h2|h3|h4|li)\b/i);
  const prefix = firstBlockIndex >= 0 ? html.slice(0, firstBlockIndex) : html;
  const suffix = firstBlockIndex >= 0 ? html.slice(firstBlockIndex) : "";

  if (!prefix.trim()) return html;

  const fragments = Array.from(prefix.matchAll(/<(b|em|i|strong|u)>([\s\S]*?)<\/\1>/gi));
  const consumed = fragments.map((match) => match[0]).join("");
  const prefixWithoutFragments = prefix.replace(/<(b|em|i|strong|u)>[\s\S]*?<\/\1>/gi, "");

  if (prefixWithoutFragments.replace(/<br>|\s/gi, "").length > 0) {
    return html;
  }

  if (consumed.trim().length === 0) return html;

  const formattedPrefix = fragments
    .flatMap((match) => {
      const tagName = match[1].toLowerCase();
      const content = normalizeFormattingFragmentText(match[2]);

      return content ? [`<p><${tagName}>${content}</${tagName}></p>`] : [];
    })
    .join("");

  return `${formattedPrefix}${suffix}`;
}

function normalizeFormattingFragmentText(value: string) {
  return value
    .replace(/^(?:<br>|\s)+/gi, "")
    .replace(/(?:<br>|\s)+$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
