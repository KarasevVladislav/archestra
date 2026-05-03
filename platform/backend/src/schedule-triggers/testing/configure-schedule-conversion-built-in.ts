import { BUILT_IN_AGENT_IDS } from "@shared";
import { eq } from "drizzle-orm";
import db, { schema } from "@/database";
import { syncBuiltInAgents } from "@/database/seed";
import AgentModel from "@/models/agent";

export async function configureScheduleConversionBuiltInForTests(params: {
  organizationId: string;
  llmApiKeyId?: string | null;
  llmModel: string;
}): Promise<{ builtInId: string }> {
  await syncBuiltInAgents();
  const builtIn = await AgentModel.getBuiltInAgent(
    BUILT_IN_AGENT_IDS.SCHEDULE_CONVERSION,
    params.organizationId,
  );
  if (!builtIn) {
    throw new Error("Schedule conversion built-in agent not seeded");
  }
  await db
    .update(schema.agentsTable)
    .set({
      llmApiKeyId: params.llmApiKeyId ?? null,
      llmModel: params.llmModel,
    })
    .where(eq(schema.agentsTable.id, builtIn.id));
  return { builtInId: builtIn.id };
}
