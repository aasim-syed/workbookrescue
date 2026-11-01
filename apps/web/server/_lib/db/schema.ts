import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { ExternalLink, Warning, CachedValue } from "../core/types.js";

const id = () => uuid("id").primaryKey().defaultRandom();
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  createdAt: created(),
});

export const users = pgTable("users", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isGuest: boolean("is_guest").notNull().default(false),
  createdAt: created(),
});

export const projects = pgTable(
  "projects",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_org_idx").on(t.organizationId)],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    format: text("format").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    version: integer("version").notNull(),
    sheets: jsonb("sheets").$type<{ name: string; hidden: boolean }[]>().notNull(),
    externalLinks: jsonb("external_links").$type<ExternalLink[]>().notNull(),
    warnings: jsonb("warnings").$type<Warning[]>().notNull(),
    cellCount: integer("cell_count").notNull(),
    /** Key of the original file in Neon Object Storage. Null for synthetic demo data. */
    storageKey: text("storage_key"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: created(),
  },
  (t) => [unique("artifacts_project_file_hash").on(t.projectId, t.filename, t.sha256), index("artifacts_project_idx").on(t.projectId)],
);

export const cells = pgTable(
  "cells",
  {
    artifactId: uuid("artifact_id").notNull().references(() => artifacts.id, { onDelete: "cascade" }),
    sheet: text("sheet").notNull(),
    address: text("address").notNull(),
    formula: text("formula"),
    cached: jsonb("cached").$type<CachedValue>(),
  },
  (t) => [primaryKey({ columns: [t.artifactId, t.sheet, t.address] })],
);

/** Reviewer decision: "links named `target` inside `sourceFilename` mean `resolvedFilename`". Survives new file versions. */
export const mappings = pgTable(
  "mappings",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    sourceFilename: text("source_filename").notNull(),
    target: text("target").notNull(),
    resolvedFilename: text("resolved_filename").notNull(),
    reason: text("reason").notNull().default(""),
    reviewerId: uuid("reviewer_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: created(),
  },
  (t) => [unique("mappings_unique").on(t.projectId, t.sourceFilename, t.target)],
);

export const steps = pgTable(
  "workflow_steps",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    kind: text("kind").notNull(), // manual_copy | export_import | override | documented_handoff
    instructions: text("instructions").notNull(),
    ownerRole: text("owner_role").notNull(),
    evidence: text("evidence").notNull().default(""),
    status: text("status").notNull().default("User-declared"), // User-declared | Verified
    fromFilename: text("from_filename"),
    fromSheet: text("from_sheet"),
    fromAddress: text("from_address"),
    toFilename: text("to_filename"),
    toSheet: text("to_sheet"),
    toAddress: text("to_address"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: created(),
  },
  (t) => [index("steps_project_idx").on(t.projectId, t.ordinal)],
);

export const baselines = pgTable("baselines", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  notes: text("notes").notNull().default(""),
  approvalStatus: text("approval_status").notNull().default("pending"),
  approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  manifest: jsonb("manifest").$type<{ filename: string; artifactId: string; sha256: string; version: number }[]>().notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: created(),
});

export const assertions = pgTable("assertions", {
  id: id(),
  baselineId: uuid("baseline_id").notNull().references(() => baselines.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  sheet: text("sheet").notNull(),
  address: text("address").notNull(),
  mode: text("mode").notNull().default("number"),
  expected: text("expected"),
  absTolerance: text("abs_tolerance"),
});

export const testRuns = pgTable("test_runs", {
  id: id(),
  baselineId: uuid("baseline_id").notNull().references(() => baselines.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  results: jsonb("results").$type<unknown[]>().notNull(),
  manifest: jsonb("manifest").$type<{ filename: string; artifactId: string; sha256: string; version: number }[]>().notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: created(),
});

/** Append-only. Nothing in the API updates or deletes these rows. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id"),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    objectType: text("object_type").notNull(),
    objectId: text("object_id"),
    summary: text("summary").notNull(),
    payloadHash: text("payload_hash"),
    createdAt: created(),
  },
  (t) => [index("audit_project_idx").on(t.projectId, t.createdAt)],
);

/** Fixed-window counters shared by every serverless instance. Rows older than a couple of days are purged by maintenance. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    bucket: bigint("bucket", { mode: "number" }).notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.key, t.bucket] })],
);

/** A reviewer's decision to accept a known limitation (for example a macro that is not analysed). Never used for unresolved dependencies. */
export const unknownAcks = pgTable(
  "unknown_acks",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    reason: text("reason").notNull(),
    reviewerId: uuid("reviewer_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: created(),
  },
  (t) => [unique("unknown_acks_unique").on(t.projectId, t.key)],
);
