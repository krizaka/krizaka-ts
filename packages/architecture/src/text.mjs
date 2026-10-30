// The text version of the C4 view (every drawing carries one): a list of nodes and a list of relations per level.
const TITLES = { context: "System context", containers: "Containers", components: "Components" };

const brief = (text) => (text.length > 120 ? `${text.slice(0, 117).trimEnd()}...` : text);

const nodeLine = (n) => {
  const what = [n.kind, n.technology].filter(Boolean).join(", ");
  const about = n.description ? ": " + brief(n.description) : "";
  const size = n.fileCount ? " [" + n.fileCount + " file(s)]" : "";
  return `- ${n.name} (${what})${about}${size}`;
};

/** The edge lines, naming nodes rather than ids. */
function edgeLines(level) {
  const name = new Map(level.nodes.map((n) => [n.id, n.name]));
  return level.edges.map((e) => {
    const files = e.count > 1 ? " (" + e.count + " files)" : "";
    return `- ${name.get(e.from) ?? e.from} ${e.label} ${name.get(e.to) ?? e.to}${files}`;
  });
}

export function toText(c4) {
  const blocks = Object.values(c4.levels).map((level) =>
    [
      `## ${TITLES[level.level]}`,
      "",
      ...level.nodes.map(nodeLine),
      "",
      ...(level.edges.length ? ["Relations", ...edgeLines(level)] : ["No relation found."]),
      "",
    ].join("\n"),
  );
  return `# ${c4.repo}: C4 from the code\n\n${blocks.join("\n")}`;
}
