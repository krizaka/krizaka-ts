import { defineModule } from "@krizaka/db";

/**
 * The counts of « visits »: one row per site, page, day and referrer domain. It holds no identifier, no address, no agent. Version 1
 * is frozen once released. Version 2 adds utm_source and utm_campaign (bounded slugs, never a URL) to the key.
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
    {
      version: 2,
      name: "visit_counts_utm",
      sql: (c) => `
ALTER TABLE ${c.schema}.visit_counts
  ADD COLUMN utm_source   text NOT NULL DEFAULT '' CHECK (char_length(utm_source) <= 64),
  ADD COLUMN utm_campaign text NOT NULL DEFAULT '' CHECK (char_length(utm_campaign) <= 64);
ALTER TABLE ${c.schema}.visit_counts DROP CONSTRAINT visit_counts_pkey;
ALTER TABLE ${c.schema}.visit_counts ADD PRIMARY KEY (site, page, day, referrer_domain, utm_source, utm_campaign);
CREATE INDEX visit_counts_campaign ON ${c.schema}.visit_counts (site, utm_campaign, day) WHERE utm_campaign <> '';`,
    },
  ],
});
