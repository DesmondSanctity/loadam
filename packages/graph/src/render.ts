import type { IR, ResourceGraph, ResourceKind } from "@loadam/core";

/**
 * Render the resource graph as a human-readable tree string for CLI output.
 *
 * Example:
 *   Pet  (id)
 *     create:  createPet
 *     read:    showPetById
 *     list:    listPets
 *     delete:  deletePet
 */
export function renderGraphTree(ir: IR): string {
  const { resources } = ir;
  if (resources.kinds.length === 0) {
    return "(no resources detected)";
  }

  const lines: string[] = [];
  for (const kind of resources.kinds) {
    lines.push(formatKind(kind));
    const inEdges = resources.edges.filter((e) => e.from === kind.name);
    if (inEdges.length > 0) {
      const parents = [...new Set(inEdges.map((e) => e.to))].join(", ");
      lines.push(`    depends on: ${parents}`);
    }
  }
  return lines.join("\n");
}

function formatKind(kind: ResourceKind): string {
  const head = `${kind.name}  (${kind.idField})`;
  const rows: string[] = [head];
  if (kind.createOps.length > 0) rows.push(`    create:  ${kind.createOps.join(", ")}`);
  if (kind.readOps.length > 0) rows.push(`    read:    ${kind.readOps.join(", ")}`);
  if (kind.listOps.length > 0) rows.push(`    list:    ${kind.listOps.join(", ")}`);
  if (kind.updateOps.length > 0) rows.push(`    update:  ${kind.updateOps.join(", ")}`);
  if (kind.deleteOps.length > 0) rows.push(`    delete:  ${kind.deleteOps.join(", ")}`);
  return rows.join("\n");
}

/** Summary stats for the graph. */
export function graphStats(graph: ResourceGraph): {
  kinds: number;
  edges: number;
  orphanKinds: string[];
} {
  const linked = new Set<string>();
  for (const e of graph.edges) {
    linked.add(e.from);
    linked.add(e.to);
  }
  const orphanKinds = graph.kinds.filter((k) => !linked.has(k.name)).map((k) => k.name);
  return {
    kinds: graph.kinds.length,
    edges: graph.edges.length,
    orphanKinds,
  };
}
