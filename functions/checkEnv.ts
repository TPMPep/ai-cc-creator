import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const secrets = {
    INTERNAL_CHAIN_SECRET: !!Deno.env.get("INTERNAL_CHAIN_SECRET"),
    INTERNAL_CHAIN_SECRET_LENGTH: Deno.env.get("INTERNAL_CHAIN_SECRET")?.length || 0,
    OPENAI_API_KEY: !!Deno.env.get("OPENAI_API_KEY"),
    ASSEMBLYAI_API_KEY: !!Deno.env.get("ASSEMBLYAI_API_KEY"),
  };

  return Response.json({ secrets });
});