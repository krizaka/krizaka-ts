// The shared dependency-cruiser rules of a Krizaka app (the stack ADR, decision S11). An app extends it and adds its own:
//
//   // .dependency-cruiser.cjs
//   module.exports = { extends: "@krizaka/config/dependency-cruiser", forbidden: [/* the app's rules */] };
//
// dependency-cruiser concatenates `forbidden` and merges `options`. CommonJS: dependency-cruiser requires its configs.

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "krizaka-no-direct-tanstack",
      severity: "error",
      comment:
        "@tanstack/* enters an app only through its @krizaka facade (@krizaka/query, @krizaka/ui/data-table, @krizaka/ui/form, " +
        "@krizaka/ui/virtual, @krizaka/pacer…): the facade's version is the contract, a TanStack break is fixed in one place.",
      // the app's own sources; the @krizaka/* packages in node_modules are where TanStack belongs
      from: { pathNot: "(^|/)node_modules/" },
      // resolved (node_modules/…/@tanstack/…) or not (a transitive package the app does not declare)
      to: { path: "(^|/)@tanstack/" },
    },
  ],
  options: {
    doNotFollow: { path: "(^|/)node_modules/" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
