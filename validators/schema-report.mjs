import { z } from 'zod';

export const ReportSchema = z.object({
  input: z.object({
    type: z.enum(['zip', 'dir', 'url']),
    path: z.string(),
    sha: z.string().nullable(),
  }),
  category: z.string(),
  status: z.enum(['success', 'partial', 'unsupported', 'failed']),
  confidence: z.number().min(0).max(1),
  appliedTransforms: z.array(z.object({
    id: z.string(),
    strategy: z.string(),
    fallbackUsed: z.boolean(),
    filesChanged: z.number(),
  }).passthrough()),
  warnings: z.array(z.any()),
  blockers: z.array(z.any()),
  build: z.object({
    ok: z.boolean(),
    durationMs: z.number(),
    errors: z.array(z.string()),
  }),
  smoke: z.object({
    ok: z.boolean(),
    consoleErrors: z.array(z.string()),
    bundleSize: z.number(),
  }),
  deployGuide: z.string(),
  durationMs: z.number(),
});

export function validateReport(data) {
  return ReportSchema.safeParse(data);
}
