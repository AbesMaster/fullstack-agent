"use client";
import { useState } from "react";

export function IntakeViewer({ id }: { id: string }) {
  const [data, setData] = useState<string | null>(null);
  return (
    <>
      <button className="ml-2 text-xs underline" onClick={async () => setData(JSON.stringify(await (await fetch(`/api/admin/intake?id=${id}`)).json(), null, 2))}>view (logged)</button>
      {data && <pre className="mt-2 max-w-md overflow-auto rounded bg-ivory p-2 text-xs">{data}</pre>}
    </>
  );
}
