import { NextResponse } from "next/server";

// Always evaluate at request time — used by the container healthcheck.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "savepoint",
    timestamp: new Date().toISOString(),
  });
}
