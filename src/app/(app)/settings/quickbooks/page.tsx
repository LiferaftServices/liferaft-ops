import { requireStaff } from "@/lib/auth";
import { missingQboSettings } from "@/lib/qbo/config";
import { createClient } from "@/lib/supabase/server";
import { DisconnectButton, SyncButton } from "./controls";

export const instant = false;

const RESULTS: Record<string, { text: string; ok: boolean }> = {
  connected: { text: "QuickBooks is connected.", ok: true },
  declined: { text: "The connection was cancelled at Intuit.", ok: false },
  invalid: { text: "The reply from Intuit could not be verified. Please try again.", ok: false },
  failed: { text: "The connection failed. Check the keys in the hosting settings and try again.", ok: false },
};

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        timeZone: "America/New_York",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "never";

export default async function QuickBooksSettings({
  searchParams,
}: PageProps<"/settings/quickbooks">) {
  const staff = await requireStaff();
  const { result } = await searchParams;
  const notice = typeof result === "string" ? RESULTS[result] : undefined;
  const missing = missingQboSettings();

  const supabase = await createClient();
  const { data } = await supabase.rpc("qbo_connection_status");
  const status = Array.isArray(data) ? data[0] : undefined;
  const isAdmin = staff.role === "admin";
  const { data: admins } = await supabase
    .from("staff")
    .select("full_name, email")
    .eq("role", "admin")
    .eq("active", true)
    .order("full_name");

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-12">
      <header>
        <h1 className="text-2xl font-semibold">QuickBooks connection</h1>
        <p className="mt-2 opacity-75">
          QuickBooks stays the source of truth for customers. This system keeps a copy to search
          and only writes to QuickBooks when someone approves an action.
        </p>
      </header>

      {notice ? (
        <p role="status" className={notice.ok ? "font-semibold" : "font-semibold text-red-700"}>
          {notice.text}
        </p>
      ) : null}

      {missing.length ? (
        <section className="rounded border border-zinc-500/40 p-4">
          <h2 className="font-semibold">Setup needed</h2>
          <p className="mt-2 text-sm">
            These settings are not yet filled in on the hosting service:
          </p>
          <ul className="mt-2 list-disc pl-6 font-mono text-sm">
            {missing.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </section>
      ) : status ? (
        <>
          <section className="rounded border border-zinc-500/40 p-4">
            <h2 className="font-semibold">Connected</h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="opacity-75">Company</dt>
              <dd>{status.company_name ?? "Unknown"}</dd>
              <dt className="opacity-75">Type</dt>
              <dd>
                {status.environment === "production"
                  ? "Live company"
                  : "Practice company (sandbox)"}
              </dd>
              <dt className="opacity-75">Connected</dt>
              <dd>{when(status.connected_at)}</dd>
              <dt className="opacity-75">Customers last copied</dt>
              <dd>
                {when(status.last_sync_at)}
                {status.last_sync_count != null
                  ? ` (${Number(status.last_sync_count).toLocaleString("en-US")} customers)`
                  : ""}
              </dd>
            </dl>
            {status.last_sync_error ? (
              <p className="mt-3 text-sm text-red-700">Last error: {status.last_sync_error}</p>
            ) : null}
          </section>
          <SyncButton />
          {isAdmin ? (
            <a href="/api/qbo/customers-export" className="w-fit text-sm font-semibold underline">
              Download the customer copy (CSV)
            </a>
          ) : null}
          {isAdmin ? <DisconnectButton /> : null}
        </>
      ) : isAdmin ? (
        <section className="flex flex-col gap-3">
          <p>QuickBooks is not connected yet.</p>
          {/* A plain link: this goes to a server route that redirects to Intuit. */}
          <a
            href="/api/qbo/connect"
            className="w-fit rounded bg-[#FF5200] px-4 py-2 font-semibold text-white"
          >
            Connect to QuickBooks
          </a>
        </section>
      ) : (
        <p>QuickBooks is not connected yet. An admin needs to connect it.</p>
      )}

      <footer className="border-t border-zinc-500/40 pt-4 text-sm">
        <h2 className="font-semibold">Need help?</h2>
        <p className="mt-1">
          If the connection or a QuickBooks action fails, contact a system administrator:
        </p>
        <ul className="mt-1">
          {(admins ?? []).map((a) => (
            <li key={a.email}>
              {a.full_name},{" "}
              <a className="underline" href={`mailto:${a.email}`}>
                {a.email}
              </a>
            </li>
          ))}
        </ul>
      </footer>
    </main>
  );
}
