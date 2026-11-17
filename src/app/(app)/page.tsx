import { MAIN_STAGES, SIDE_STAGES, STAGE_LABELS } from "@/lib/workflow";

// Placeholder home page for the foundation step. It shows that the app is running
// and reads the workflow stages from the same rules the server will enforce.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-[#FF5200]">
          Liferaft Services
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Operations system</h1>
        <p className="mt-3 opacity-75">
          Foundation build. You are signed in as staff. Customers and asset records arrive in the next steps.
        </p>
      </header>

      <section>
        <h2 className="text-lg font-semibold">Workflow stages</h2>
        <ol className="mt-3 list-decimal space-y-1 pl-6">
          {MAIN_STAGES.map((stage) => (
            <li key={stage}>{STAGE_LABELS[stage]}</li>
          ))}
        </ol>
        <h3 className="mt-6 font-semibold">Side stages</h3>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          {SIDE_STAGES.map((stage) => (
            <li key={stage}>{STAGE_LABELS[stage]}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
