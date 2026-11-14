/* The install command of one or several packages in each package manager — the one list the home's hero and every package page share. */

export const MANAGERS = [
  { id: "npm", command: (names: string) => `npm install ${names}` },
  { id: "pnpm", command: (names: string) => `pnpm add ${names}` },
  { id: "yarn", command: (names: string) => `yarn add ${names}` },
  { id: "bun", command: (names: string) => `bun add ${names}` },
] as const;

/** The one package the home's hero installs: the foundation the others build on. */
export const HERO_PACKAGE = "@krizaka/db";
