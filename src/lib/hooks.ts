"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Calls `onChange` whenever a row in one of `tables` changes (Supabase Realtime; RLS decides
 * what each user receives). Also fires when the tab regains focus, as a safety net.
 */
export function useRealtime(tables: { table: string; filter?: string }[], onChange: () => void) {
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });
  const key = JSON.stringify(tables);

  useEffect(() => {
    const supabase = createClient();
    const list = JSON.parse(key) as { table: string; filter?: string }[];
    let channel = supabase.channel(`rt-${Math.random().toString(36).slice(2)}`);
    list.forEach(({ table, filter }) => {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, () => cb.current());
    });
    channel.subscribe();
    const onFocus = () => cb.current();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      supabase.removeChannel(channel);
    };
  }, [key]);
}

/** Strip characters that have meaning inside a PostgREST `or()` / `ilike` filter value. */
export const cleanSearch = (s: string) => s.replace(/[,()%*\\:"']/g, " ").trim();
