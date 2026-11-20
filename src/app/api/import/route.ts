import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { runImport, type ImportFile } from "@/lib/import";

// Admin-only: receives a prepared import file and loads it into the database.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (session.status !== "staff" || session.staff.role !== "admin") {
    return NextResponse.json({ error: "Only an admin can import data." }, { status: 403 });
  }
  let file: ImportFile;
  try {
    const form = await request.formData();
    const upload = form.get("file");
    if (!(upload instanceof File)) throw new Error("No file was attached.");
    if (upload.size > 50 * 1024 * 1024) throw new Error("That file is too large.");
    file = JSON.parse(await upload.text()) as ImportFile;
  } catch (err) {
    const message = err instanceof Error ? err.message : "The file could not be read.";
    return NextResponse.json({ error: `The file could not be read: ${message}` }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, loaded: await runImport(file) });
  } catch (err) {
    console.error("Import failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Import failed." }, { status: 500 });
  }
}
