import "server-only";
import { PHOTO_BUCKET, type JobPhoto, type PhotoKind } from "@/lib/photos";
import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

/** A job's photos with links that work for one hour, for staff who are signed in. */
export async function jobPhotos(db: Db, jobId: string): Promise<JobPhoto[]> {
  const { data } = await db
    .from("job_photos")
    .select("id, kind, path, created_at, staff:created_by(full_name)")
    .eq("job_id", jobId)
    .order("created_at");
  const rows = (data ?? []) as unknown as { id: string; kind: PhotoKind; path: string; created_at: string; staff: { full_name: string } | null }[];
  if (!rows.length) return [];
  const { data: signed } = await db.storage.from(PHOTO_BUCKET).createSignedUrls(rows.map((r) => r.path), 3600);
  return rows
    .map((r, i) => ({ id: r.id, kind: r.kind, url: signed?.[i]?.signedUrl ?? "", when: r.created_at, who: r.staff?.full_name ?? null }))
    .filter((p) => p.url);
}
