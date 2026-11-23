export const PHOTO_KINDS = {
  serial: "Serial number inside the raft",
  painter_op_head: "Painter tied to the operating head",
  painter_raft: "Painter tied to the tow patch or raft",
  delivery: "Delivery",
  other: "Other",
} as const;
export type PhotoKind = keyof typeof PHOTO_KINDS;
/** The three photos every inspection needs. */
export const REQUIRED_PHOTOS: PhotoKind[] = ["serial", "painter_op_head", "painter_raft"];
export const PHOTO_BUCKET = "job-photos";

export interface JobPhoto {
  id: string;
  kind: PhotoKind;
  url: string;
  when: string;
  who: string | null;
}
