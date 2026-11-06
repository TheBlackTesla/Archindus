import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const accountProfiles = sqliteTable('account_profiles', {
 userId:text('user_id').primaryKey(),
 dataVersion:text('data_version').notNull().default(''),
 displayName:text('display_name').notNull().default(''),
 instructions:text('instructions').notNull().default(''),
 memoryEnabled:integer('memory_enabled').notNull().default(1),
 historyEnabled:integer('history_enabled').notNull().default(1),
 modelPolicy:text('model_policy').notNull().default('auto'),
 createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),
});
export const accountMemories = sqliteTable('account_memories', {
 id:text('id').primaryKey(),userId:text('user_id').notNull(),content:text('content').notNull(),createdAt:integer('created_at').notNull(),
},table=>[index('idx_memory_user').on(table.userId)]);
export const accountConversations = sqliteTable('account_conversations', {
 id:text('id').primaryKey(),userId:text('user_id').notNull(),title:text('title').notNull(),messages:text('messages').notNull(),updatedAt:integer('updated_at').notNull(),
},table=>[index('idx_conversation_user_updated').on(table.userId,table.updatedAt)]);

export const accountPersonalities=sqliteTable('account_personalities',{
 id:text('id').primaryKey(),userId:text('user_id').notNull(),nodeSlot:integer('node_slot'),name:text('name').notNull(),description:text('description').notNull(),instructions:text('instructions').notNull(),capability:text('capability').notNull(),modelPolicy:text('model_policy').notNull().default('inherit'),createdAt:integer('created_at').notNull(),
},table=>[index('idx_personality_user').on(table.userId),uniqueIndex('idx_personality_user_slot').on(table.userId,table.nodeSlot)]);

// Speech text/audio is never stored in the quota ledger. Failed/ambiguous calls
// retain their character reservation to keep possible provider charges bounded.
export const voiceUsage=sqliteTable('voice_usage',{
 id:text('id').primaryKey(),userId:text('user_id').notNull(),day:text('day').notNull(),month:text('month').notNull(),characters:integer('characters').notNull(),createdAt:integer('created_at').notNull(),activeUntil:integer('active_until').notNull(),
},table=>[index('idx_voice_day').on(table.day),index('idx_voice_month').on(table.month),index('idx_voice_user_created').on(table.userId,table.createdAt)]);
