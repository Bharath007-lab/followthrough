import 'dotenv/config';
import { verifyBluesMindsConnection } from '../server/lib/llm.ts';

async function main() {
  console.log('Running 5-step BluesMinds API verification...\n');
  const result = await verifyBluesMindsConnection();

  for (const step of result.steps) {
    const icon = step.status === 'pass' ? 'PASS' : step.status === 'fail' ? 'FAIL' : 'SKIP';
    console.log(`[${icon}] Step ${step.step}: ${step.name} — ${step.detail}`);
  }

  console.log('\nSummary:', {
    verified: result.verified,
    baseUrl: result.baseUrl,
    configuredModel: result.configuredModel,
    actualModelUsed: result.actualModelUsed,
    latencyMs: result.latencyMs,
    tokenUsage: result.tokenUsage,
    error: result.error,
  });

  if (!result.verified) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Verification script failed:', err);
  process.exitCode = 1;
});
