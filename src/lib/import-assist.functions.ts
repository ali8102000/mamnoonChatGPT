import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { schemaSummary } from "@/lib/import-schema";

const inputSchema = z.object({
  fileName: z.string().max(255),
  headers: z.array(z.string().max(100)).min(1).max(100),
  rowCount: z.number().int().min(0).max(1_000_000),
  stats: z.record(z.object({ empty: z.number().nonnegative(), distinct: z.number().nonnegative() })),
  sampleRows: z.array(z.array(z.string().max(500)).max(100)).max(15),
});

export type CsvMappingResult = {
  target_table: string;
  confidence: number;
  summary_ar: string;
  mappings: Array<{ csv_column: string; target_column: string | null; note: string }>;
  issues: Array<{ severity: "high" | "medium" | "low"; column?: string; explanation_ar: string }>;
};

export const suggestCsvMapping = async ({ data }: { data: z.infer<typeof inputSchema> }): Promise<CsvMappingResult> => {
  const input = inputSchema.parse(data);
  const { data: result, error } = await supabase.functions.invoke("import-assist", {
    body: { ...input, schemaSummary },
  });
  if (error || result?.error) throw new Error("تعذّر تحليل الملف. تحقق من صلاحية الإدارة ثم حاول مجدداً.");
  return result as CsvMappingResult;
};
