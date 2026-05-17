// ADDON: saas-mt — Customer area layout (separate from /dashboard admin)
import "@/app/globals.css";

export const metadata = {
  title: "Cortex AI Router — Customer Portal",
  description: "Manage your API key and monitor usage",
};

export default function CustomerLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
