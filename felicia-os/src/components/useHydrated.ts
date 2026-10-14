"use client";
import { useEffect, useState } from "react";

/** False until React has hydrated — used to keep submit buttons disabled so a form can never fall back to a native GET submit (which would put personal data in the URL). */
export function useHydrated() {
  const [h, setH] = useState(false);
  useEffect(() => setH(true), []);
  return h;
}
