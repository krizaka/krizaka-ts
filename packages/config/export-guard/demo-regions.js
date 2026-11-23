// Demo data in an export (krizaka-internal#4678): an element marked `data-demo` whose subtree shows a visible « exemple » /
// « example » label may carry sample amounts. Two linear scans, no regex with backtracking and no allow-list of amounts:
//   - markup: a pass over the tags with a stack of open elements (the `data-demo` attribute);
//   - React flight payload (a `.txt` file or an inline script, escaped or not): a pass over the braces (the `"data-demo"` prop).
// A region is `{ start, end, labelled }`, offsets into the file content.

/** @typedef {{ start: number, end: number, labelled: boolean }} DemoRegion */

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const RAW_TEXT = new Set(["script", "style"]);
const LABEL = /exemple|example/gi;
const isWordChar = (/** @type {string} */ c) => /[\w-]/.test(c);

/** Whether `text` holds « exemple » or « example » as a word of its own. @param {string} text */
function hasLabel(text) {
  for (const m of text.matchAll(LABEL)) {
    if (!isWordChar(text.charAt(m.index - 1)) && !isWordChar(text.charAt(m.index + m[0].length))) return true;
  }
  return false;
}

const isNameChar = (/** @type {string} */ c) => /[A-Za-z0-9:_-]/.test(c);
const isSpace = (/** @type {string} */ c) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";

/** The end of an attribute value that starts at `i` (after the "="): quoted or bare. @param {string} text @param {number} i */
function valueEnd(text, i) {
  const quote = text.charAt(i);
  if (quote === '"' || quote === "'") {
    const close = text.indexOf(quote, i + 1);
    return close < 0 ? text.length : close + 1;
  }
  while (i < text.length && !isSpace(text.charAt(i)) && text.charAt(i) !== ">") i++;
  return i;
}

/** The attribute that starts at `at`: where it ends, and whether it is `data-demo`. @param {string} text @param {number} at */
function readAttribute(text, at) {
  let i = at;
  while (i < text.length && !isSpace(text.charAt(i)) && !"=/>".includes(text.charAt(i))) i++;
  const demo = text.slice(at, i).toLowerCase() === "data-demo";
  return { demo, end: text.charAt(i) === "=" ? valueEnd(text, i + 1) : i };
}

/**
 * The tag that starts at `at` (the "<"): its name, whether it has the `data-demo` attribute, where it ends and whether it
 * closes itself. One pass, quotes respected.
 * @param {string} text @param {number} at
 */
function readTag(text, at) {
  let i = at + 1;
  const closing = text.charAt(i) === "/";
  if (closing) i++;
  const nameStart = i;
  while (i < text.length && isNameChar(text.charAt(i))) i++;
  const name = text.slice(nameStart, i).toLowerCase();
  let demo = false;
  let selfClosing = false;
  while (i < text.length && text.charAt(i) !== ">") {
    const c = text.charAt(i);
    selfClosing = c === "/";
    if (isSpace(c) || selfClosing) i++;
    else {
      const attribute = readAttribute(text, i);
      demo ||= attribute.demo;
      i = attribute.end;
    }
  }
  return { closing, name, demo, selfClosing, end: Math.min(i + 1, text.length) };
}

/** The end of a `<script>` / `<style>` body that starts at `from`. @param {string} text @param {string} name @param {number} from */
function rawTextEnd(text, name, from) {
  for (let i = text.indexOf("</", from); i >= 0; i = text.indexOf("</", i + 2)) {
    if (text.slice(i + 2, i + 2 + name.length).toLowerCase() === name) return i;
  }
  return text.length;
}

/** @typedef {{ regions: DemoRegion[], open: string[], demo: { depth: number, region: DemoRegion } | null }} Scan */

/** A closing tag: pops the open elements, and ends the demo region when its root is closed. @param {Scan} scan @param {{ name: string, end: number }} tag */
function closeTag(scan, tag) {
  const at = scan.open.lastIndexOf(tag.name);
  if (at >= 0) scan.open.length = at;
  if (scan.demo && scan.open.length <= scan.demo.depth) {
    scan.demo.region.end = tag.end;
    scan.demo = null;
  }
}

/** An opening tag: starts a demo region (the outermost only) and pushes the element. Returns the text offset to go on from. @param {Scan} scan @param {ReturnType<typeof readTag>} tag @param {number} at @param {string} text */
function openTag(scan, tag, at, text) {
  const empty = tag.selfClosing || VOID.has(tag.name);
  if (tag.demo && !scan.demo) {
    const region = { start: at, end: empty ? tag.end : text.length, labelled: false };
    scan.regions.push(region);
    if (!empty) scan.demo = { depth: scan.open.length, region };
  }
  if (empty) return tag.end;
  scan.open.push(tag.name);
  return RAW_TEXT.has(tag.name) ? rawTextEnd(text, tag.name, tag.end) : tag.end;
}

/** The demo regions of the markup. @param {string} text @returns {DemoRegion[]} */
function markupRegions(text) {
  /** @type {Scan} */
  const scan = { regions: [], open: [], demo: null };
  let i = 0;
  for (let lt = text.indexOf("<"); lt >= 0; lt = text.indexOf("<", i)) {
    if (scan.demo && hasLabel(text.slice(i, lt))) scan.demo.region.labelled = true;
    if (text.startsWith("<!--", lt)) {
      const close = text.indexOf("-->", lt + 4);
      i = close < 0 ? text.length : close + 3;
      continue;
    }
    const tag = readTag(text, lt);
    i = tag.end;
    if (tag.closing) closeTag(scan, tag);
    else if (tag.name) i = openTag(scan, tag, lt, text);
  }
  return scan.regions;
}

/** Whether the string that holds the text at `at` is a child of an element, not a prop such as `className`. @param {string} text @param {number} at */
function isChildText(text, at) {
  let quote = text.lastIndexOf('"', at);
  if (quote > 0 && text.charAt(quote - 1) === "\\") quote--;
  const before = text.slice(Math.max(0, quote - 14), quote);
  if (!before.endsWith(":")) return true;
  let end = before.length;
  while (end > 0 && ':"\\'.includes(before.charAt(end - 1))) end--;
  return before.slice(0, end).endsWith("children");
}

/** Whether a payload slice shows the label as the text of an element. @param {string} text */
function payloadLabelled(text) {
  for (const m of text.matchAll(LABEL)) {
    if (isWordChar(text.charAt(m.index - 1)) || isWordChar(text.charAt(m.index + m[0].length))) continue;
    if (isChildText(text, m.index)) return true;
  }
  return false;
}

/** Whether `"data-demo":` (or its escaped form) is the key that starts at `at`. @param {string} text @param {number} at */
function isDemoKey(text, at) {
  const key = "data-demo";
  let i = at - 1;
  if (text.charAt(i) !== '"') return false;
  i = at + key.length;
  if (text.charAt(i) === "\\") i++;
  return text.charAt(i) === '"' && text.charAt(i + 1) === ":";
}

/** The demo regions of a flight payload: the props object that has the `data-demo` key. @param {string} text @returns {DemoRegion[]} */
function payloadRegions(text) {
  /** @type {DemoRegion[]} */
  const regions = [];
  /** @type {number[]} */
  const braces = [];
  let root = -1;
  let key = text.indexOf("data-demo");
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === "\n") {
      braces.length = 0;
      root = -1;
    } else if (c === "{") braces.push(i);
    else if (c === "}") {
      const start = braces.pop();
      if (start !== undefined && braces.length === root) {
        const end = i + 1;
        regions.push({ start, end, labelled: payloadLabelled(text.slice(start, end)) });
        root = -1;
      }
    }
    if (i === key) {
      if (root < 0 && braces.length > 0 && isDemoKey(text, i)) root = braces.length - 1;
      key = text.indexOf("data-demo", i + 1);
    }
  }
  return regions;
}

/** The demo regions of a file, outermost first, in order. @param {string} content @returns {DemoRegion[]} */
export function demoRegions(content) {
  if (!/data-demo/i.test(content)) return [];
  return [...markupRegions(content), ...payloadRegions(content)].sort((a, b) => a.start - b.start);
}

/** The content with the labelled demo regions blanked (line breaks kept), for the rules that must not read sample data. @param {string} content @param {readonly DemoRegion[]} regions */
export function withoutDemoData(content, regions) {
  let out = "";
  let copied = 0;
  for (const r of regions) {
    if (!r.labelled || r.start < copied) continue;
    out += content.slice(copied, r.start) + content.slice(r.start, r.end).replace(/[^\n]/g, " ");
    copied = r.end;
  }
  return out + content.slice(copied);
}
