// ─────────────────────────────────────────────────────
//  TypeScript type definitions for Materio
// ─────────────────────────────────────────────────────

/** A section within a subject (e.g. Chapters, Assignments, Question Banks) */
export interface ResourceSection {
  type: string;
  content: string[];
}

/** Subject → array of sections */
export type SubjectData = ResourceSection[];

/** Semester → Subject → Sections  (the JSON structure) */
export interface ResourceLibrary {
  [semester: string]: {
    [subject: string]: SubjectData;
  };
}

/** Flat representation of a single resource item */
export interface ResourceItem {
  semester: string;
  subject: string;
  sectionType: string;
  topic: string;
  pdfUrl: string;
}
