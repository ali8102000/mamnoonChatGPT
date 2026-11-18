import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { getSupabasePublishableKey } from "../_shared/api-keys.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error("missing_" + name);
  return value;
};
const normalize = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]/g, "");
const aliases: Record<string, string> = {
  name: "full_name", fullname: "full_name", customername: "full_name",
  mobile: "phone", mobilenumber: "phone", phonenumber: "phone",
  emailaddress: "email", customer: "customer_id", provider: "provider_id",
  userid: "user_id", customerid: "customer_id", providerid: "provider_id",
  latitude: "pickup_lat", lat: "pickup_lat", longitude: "pickup_lng", lng: "pickup_lng",
  price: "customer_price", total: "amount", date: "created_at",
};

type Mapping = { csv_column: string; target_column: string | null; note: string };
type Issue = { severity: "high" | "medium" | "low"; column?: string; explanation_ar: string };
type Result = { target_table: string; confidence: number; summary_ar: string; mappings: Mapping[]; issues: Issue[] };

function heuristic(headers: string[], rowCount: number, stats: Record<string, any>, schemaSummary: string): Result {
  const columns: Array<{ table: string; column: string }> = [];
  for (const line of schemaSummary.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const table = line.slice(0, colon).trim();
    const fields = line.slice(colon + 1);
    for (const match of fields.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) {
      columns.push({ table, column: match[1] });
    }
  }
  const tableScores = new Map<string, number>();
  const mappings = headers.map((header): Mapping => {
    const key = normalize(header);
    const alias = aliases[key];
    let best: { table: string; column: string; score: number } | null = null;
    for (const candidate of columns) {
      const candidateKey = normalize(candidate.column);
      let score = 0;
      if (key && key === candidateKey) score = 1;
      else if (alias && alias === candidate.column) score = 0.96;
      else if (key && (candidateKey.includes(key) || key.includes(candidateKey))) score = 0.68;
      if (score > (best?.score ?? 0)) best = { ...candidate, score };
    }
    if (!best || best.score < 0.65) {
      return { csv_column: header, target_column: null, note: "لم يتم العثور على عمود مطابق بشكل كافٍ" };
    }
    tableScores.set(best.table, (tableScores.get(best.table) ?? 0) + best.score);
    return {
      csv_column: header,
      target_column: best.column,
      note: best.score >= 0.95 ? "تطابق قوي حسب اسم العمود" : "تطابق تقريبي؛ راجع الربط قبل الاستيراد",
    };
  });
  const targetTable = [...tableScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "غير محدد";
  const matched = mappings.filter((m) => m.target_column).length;
  const confidence = headers.length ? matched / headers.length : 0;
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const header of headers) {
    if (seen.has(normalize(header))) issues.push({ severity: "high", column: header, explanation_ar: "اسم العمود مكرر في ملف CSV" });
    seen.add(normalize(header));
    const columnStats = stats[header];
    if (columnStats && Number(columnStats.empty) > 0) {
      issues.push({
        severity: Number(columnStats.empty) > Math.max(1, rowCount / 2) ? "high" : "medium",
        column: header,
        explanation_ar: `يوجد ${Number(columnStats.empty)} صفاً بقيمة فارغة في هذا العمود`,
      });
    }
    if (!mappings.find((m) => m.csv_column === header)?.target_column) {
      issues.push({ severity: "low", column: header, explanation_ar: "يحتاج هذا العمود إلى ربط يدوي" });
    }
  }
  return {
    target_table: targetTable,
    confidence,
    summary_ar: "هذا اقتراح أولي آلي حسب أسماء الأعمدة. راجع الجدول والحقول والمشاكل قبل أي استيراد؛ لم يتم تعديل قاعدة البيانات.",
    mappings,
    issues,
  };
}

function parseAiResult(raw: string): Result | null {
  const cleaned = raw.trim().replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}$/i, "");
  try {
    const value = JSON.parse(cleaned);
    if (typeof value.target_table !== "string" || !Array.isArray(value.mappings) || !Array.isArray(value.issues)) return null;
    return {
      target_table: value.target_table,
      confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
      summary_ar: String(value.summary_ar ?? ""),
      mappings: value.mappings.map((item: any) => ({
        csv_column: String(item.csv_column ?? ""),
        target_column: typeof item.target_column === "string" ? item.target_column : null,
        note: String(item.note ?? ""),
      })),
      issues: value.issues.map((item: any) => ({
        severity: ["high", "medium", "low"].includes(item.severity) ? item.severity : "low",
        column: typeof item.column === "string" ? item.column : undefined,
        explanation_ar: String(item.explanation_ar ?? ""),
      })),
    };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const url = required("SUPABASE_URL");
    const anon = getSupabasePublishableKey();
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ error: "unauthorized" }, 401);
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await caller.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "unauthorized" }, 401);
    const { data: isAdmin, error: adminError } = await caller.rpc("has_admin_access", { p_user_id: auth.user.id });
    if (adminError || isAdmin !== true) return json({ error: "admin_required" }, 403);

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.headers) || body.headers.length < 1 || body.headers.length > 100 ||
        !Array.isArray(body.sampleRows) || body.sampleRows.length > 15 ||
        typeof body.fileName !== "string" || body.fileName.length > 255 ||
        !Number.isInteger(body.rowCount) || body.rowCount < 0 || body.rowCount > 1000000 ||
        typeof body.schemaSummary !== "string" || body.schemaSummary.length > 50000 ||
        !body.stats || typeof body.stats !== "object" || Array.isArray(body.stats)) {
      return json({ error: "invalid_request" }, 400);
    }
    const headers = body.headers.map((h: unknown) => String(h).slice(0, 100));
    if (headers.some((h: string) => !h.trim())) return json({ error: "invalid_headers" }, 400);
    // Sample cell values are deliberately never forwarded to an external AI provider.
    const stats = body.stats as Record<string, any>;
    const schemaSummary = body.schemaSummary as string;

    const apiKey = Deno.env.get("AI_API_KEY");
    const model = Deno.env.get("AI_MODEL");
    if (apiKey && model) {
      const baseUrl = (Deno.env.get("AI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");
      const prompt = `أنت مساعد خبير في استيراد قواعد البيانات. حلّل ملف CSV واقترح الجدول المناسب وربط الأعمدة. لا تنفّذ أي كتابة. أرجع JSON فقط بالشكل:
{"target_table":"اسم الجدول","confidence":0.0,"summary_ar":"ملخص بالعربية","mappings":[{"csv_column":"عمود CSV","target_column":"اسم العمود أو null","note":"ملاحظة بالعربية"}],"issues":[{"severity":"high|medium|low","column":"اسم العمود اختياري","explanation_ar":"شرح بالعربية"}]}
عدد الصفوف: ${body.rowCount}
الأعمدة: ${JSON.stringify(headers)}
إحصائيات الأعمدة: ${JSON.stringify(stats)}
لم يتم إرسال محتوى الصفوف أو اسم الملف حفاظاً على الخصوصية.
مخطط قاعدة البيانات:
${schemaSummary}`;
      try {
        const response = await fetch(baseUrl + "/chat/completions", {
          method: "POST",
          headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            messages: [
              { role: "system", content: "أخرج JSON صالحاً فقط. لا تخمّن أعمدة غير موجودة في المخطط." },
              { role: "user", content: prompt },
            ],
          }),
        });
        if (response.ok) {
          const payload = await response.json();
          const content = payload?.choices?.[0]?.message?.content;
          if (typeof content === "string") {
            const parsed = parseAiResult(content);
            if (parsed) return json(parsed);
          }
        } else {
          console.error("[import-assist] AI provider returned status", response.status);
        }
      } catch (error) {
        console.error("[import-assist] AI provider request failed", error instanceof Error ? error.name : "unknown");
      }
    }
    return json(heuristic(headers, body.rowCount, stats, schemaSummary));
  } catch (error) {
    const message = String(error);
    if (message.includes("missing_")) return json({ error: "server_configuration_incomplete" }, 503);
    return json({ error: "internal_error" }, 500);
  }
});
