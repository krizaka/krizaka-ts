import { defineModule } from "@krizaka/db";

/**
 * The counts of « visits »: one row per site, page, day and referrer domain. It holds no identifier, no address, no agent. Version 1
 * is frozen once released: a change is version 2.
 */
export const visitsSchema = defineModule({
  module: "visits",
  migrations: [
    {
      version: 1,
      name: "visit_counts",
      sql: (c) => `
CREATE TABLE ${c.schema}.visit_counts (
  site            text    NOT NULL CHECK (char_length(site) BETWEEN 1 AND 60),
  page            text    NOT NULL CHECK (char_length(page) BETWEEN 1 AND 200),
  day             date    NOT NULL,
  referrer_domain text    NOT NULL DEFAULT '' CHECK (char_length(referrer_domain) <= 253),
  count           integer NOT NULL CHECK (count >= 1),
  PRIMARY KEY (site, page, day, referrer_domain)
);
CREATE INDEX visit_counts_day ON ${c.schema}.visit_counts (site, day);`,
    },
  ],
});
