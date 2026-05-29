// ADDON: saas-mt — Customer container resource stats (CPU, RAM, Disk)
import { NextResponse } from "next/server";
import { getCustomerFromRequest } from "@/lib/customer/session";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATS_FILE = path.join(process.env.DATA_DIR || "/app/data", "container-stats.json");

export async function GET(request) {
  const customer = await getCustomerFromRequest(request);
  if (!customer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get container name from customer metadata
  let containerName;
  try {
    const meta = typeof customer.metadata === "string" ? JSON.parse(customer.metadata) : (customer.metadata || {});
    containerName = meta.container;
  } catch {}

  if (!containerName) {
    return NextResponse.json({ error: "No container assigned" }, { status: 404 });
  }

  // Read stats file (written by cron every minute)
  try {
    const raw = fs.readFileSync(STATS_FILE, "utf8");
    const all = JSON.parse(raw);
    const stats = all[containerName];
    if (!stats) {
      return NextResponse.json({ error: "Container stats not available", container: containerName }, { status: 404 });
    }
    return NextResponse.json({
      container: containerName,
      ...stats,
      updatedAt: all._updatedAt,
    });
  } catch (e) {
    return NextResponse.json({ error: "Stats file not available" }, { status: 503 });
  }
}
