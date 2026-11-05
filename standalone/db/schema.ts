import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// One shared cooldown survives Worker restarts and applies to every visitor.
export const inferenceProviderState = sqliteTable("inference_provider_state", {
  provider: text("provider").primaryKey(),
  unavailableUntil: integer("unavailable_until").notNull(),
});

// No prompts, responses, raw IP addresses, or credentials are persisted here.
export const inferenceUsage = sqliteTable("inference_usage", {
  id: text("id").primaryKey(),
  day: text("day").notNull(),
  month: text("month").notNull(),
  client: text("client").notNull(),
  kind: text("kind").notNull(),
  reserved: integer("reserved").notNull(),
  charged: integer("charged").notNull(),
  createdAt: integer("created_at").notNull(),
  activeUntil: integer("active_until").notNull(),
}, table => [
  index("idx_usage_month").on(table.month),
  index("idx_usage_day_client_kind").on(table.day, table.client, table.kind),
  index("idx_usage_created").on(table.createdAt),
  index("idx_usage_active").on(table.activeUntil),
]);
