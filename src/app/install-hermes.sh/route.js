// ADDON: saas-mt — Serve install-hermes.sh as static content at /install-hermes.sh
// This lets customers run: curl -fsSL https://9router.cortex-ai.my.id/install-hermes.sh | bash
import fs from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    // Read the deploy script from disk (kept in sync with 9router-deploy/)
    const scriptPath = path.join(process.cwd(), "9router-deploy", "install-hermes.sh");
    const content = await fs.readFile(scriptPath, "utf-8");
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/x-shellscript; charset=utf-8",
        "Content-Disposition": 'inline; filename="install-hermes.sh"',
        "Cache-Control": "public, max-age=300", // 5min cache
      },
    });
  } catch (e) {
    return new Response(`# Error reading installer: ${e.message}\nexit 1\n`, {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
