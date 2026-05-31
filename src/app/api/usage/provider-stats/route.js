import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "today";

    let dateFilter = "";
    const now = new Date();
    if (period === "today") {
      dateFilter = `AND timestamp >= '${now.toISOString().slice(0, 10)}T00:00:00'`;
    } else if (period === "24h") {
      dateFilter = `AND timestamp >= '${new Date(now - 24 * 3600000).toISOString()}'`;
    } else if (period === "7d") {
      dateFilter = `AND timestamp >= '${new Date(now - 7 * 86400000).toISOString()}'`;
    } else if (period === "30d") {
      dateFilter = `AND timestamp >= '${new Date(now - 30 * 86400000).toISOString()}'`;
    } else if (period === "60d") {
      dateFilter = `AND timestamp >= '${new Date(now - 60 * 86400000).toISOString()}'`;
    }

    const db = await getAdapter();
    const rows = db.all(
      `SELECT provider,
              COUNT(*) as total,
              SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
              SUM(CASE WHEN status != 'success' OR status IS NULL THEN 1 ELSE 0 END) as failed
       FROM requestDetails
       WHERE provider IS NOT NULL ${dateFilter}
       GROUP BY provider
       ORDER BY total DESC`
    );

    return NextResponse.json({ providers: rows });
  } catch (error) {
    console.error("[API] provider-stats error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
