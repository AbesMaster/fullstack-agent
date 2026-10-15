import { NextResponse } from "next/server";
import { CLIENT_COOKIE } from "@/lib/portal/portal";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/portal", req.url), 303);
  res.cookies.delete(CLIENT_COOKIE);
  return res;
}
