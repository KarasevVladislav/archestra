ALTER TABLE "schedule_triggers" ADD COLUMN "linked_conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "schedule_triggers" ADD CONSTRAINT "schedule_triggers_linked_conversation_id_conversations_id_fk" FOREIGN KEY ("linked_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_triggers_linked_conversation_id_idx" ON "schedule_triggers" USING btree ("linked_conversation_id");
