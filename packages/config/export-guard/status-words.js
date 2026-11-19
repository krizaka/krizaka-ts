// The words a product status is shown with, mirrored from @krizaka/org (`render/surfaces.ts`, STATUS_WORDS): @krizaka/org
// depends on this package, so it cannot be imported here. The CLI checks them against @krizaka/org when it is installed.

/** @type {Readonly<Record<string, { en: string, fr: string }>>} */
export const STATUS_WORDS = Object.freeze({
  design: { en: "In design", fr: "En conception" },
  upcoming: { en: "Coming soon", fr: "Bientôt" },
  construction: { en: "Under construction", fr: "En construction" },
  development: { en: "In development", fr: "En développement" },
  devPreview: { en: "Developer preview", fr: "Aperçu pour développeurs" },
  paused: { en: "Paused", fr: "En pause" },
  released: { en: "Released", fr: "Publié" },
  retired: { en: "Retired", fr: "Retiré" },
});
