/* Which surfaces exist — supplied to the shell, never imported by it.
 *
 * WHY THIS EXISTS: store.jsx needs the valid view ids to validate the hash,
 * TopBar needs the groups to draw the nav, and Sources needs the provenance
 * table. All three used to import apps/consolidated directly, which pointed the
 * dependency backwards: the shared chrome knew the whole section list, so no
 * section could be rendered without the entire dashboard being present.
 *
 * Now the registry is passed in. apps/consolidated supplies the real one; a
 * section's standalone entry supplies `solo(...)`, naming only itself. Nothing
 * in packages/shell or packages/<section> knows what else is installed.
 */
import { createContext, useContext, useMemo } from 'react';

const Ctx = createContext(null);

/** Derive the lookups the shell asks for from the declared groups. */
export function derive(reg) {
  const groups = reg?.groups || [];
  const flat = groups.flatMap((g) => g.views);
  const viewIds = flat.map(([id]) => id);
  return {
    groups,
    viewIds,
    viewLabel: Object.fromEntries(flat),
    defaultView: reg?.defaultView || viewIds[0],
    sources: reg?.sources || {},
    kindLabel: reg?.kindLabel || {},
    /* Falls back to the first group so the nav always has something
       highlighted rather than rendering an empty second row. */
    groupOf: (view) =>
      groups.find((g) => g.views.some(([id]) => id === view))?.id || groups[0]?.id,
    groupById: (id) => groups.find((g) => g.id === id) || groups[0],
  };
}

export function RegistryProvider({ value, children }) {
  const derived = useMemo(() => derive(value), [value]);
  return <Ctx.Provider value={derived}>{children}</Ctx.Provider>;
}

export function useRegistry() {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      'useRegistry outside a RegistryProvider — wrap the tree in one. '
      + 'apps/consolidated passes the full registry; a standalone section passes solo().',
    );
  }
  return v;
}

/** A registry naming a single surface, for a section running on its own. */
export const solo = (id, label) => ({
  groups: [{ id, label, views: [[id, label]] }],
  defaultView: id,
  sources: {},
});
