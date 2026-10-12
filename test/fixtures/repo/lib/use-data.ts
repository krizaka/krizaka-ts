"use client";
// stack: fetchInClientEffect 2 · directTanstackImport 2 · retiredImport 1 (when "framer-motion" is retired)
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

export function useData(url: string, refetch: () => void) {
  const [data, setData] = useState<unknown>(null);
  useEffect(() => {
    fetch(url).then((r) => r.json()).then(setData); // ")" in a comment
    void krizakaFetch(`${url}?)`);
    refetch();
  }, [url, refetch]);
  const save = () => fetch(url, { method: "POST" }); // outside an effect: not counted
  return { data, save, useQuery, motion } as { data: unknown; columns?: ColumnDef<unknown> };
}
declare function krizakaFetch(url: string): Promise<unknown>;
