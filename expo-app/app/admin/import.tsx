import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

const MAX_CSV_CHARS = 2_000_000;
const PREVIEW_ROWS = 20;
const TARGET_TABLES = [
  "profiles", "service_requests", "driver_profiles", "worker_profiles",
  "services", "transactions", "notifications", "support_tickets",
  "support_ticket_messages", "coupons", "pricing_rules", "vehicle_models",
];

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("يوجد حقل نصي مفتوح بعلامة اقتباس ولم يُغلق.");
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((line) => line.some((value) => value.trim() !== ""));
}

export default function ImportScreen() {
  const { loading, session, roles } = useAuth();
  const [csvText, setCsvText] = useState("");
  const [targetTable, setTargetTable] = useState("profiles");
  const [error, setError] = useState("");
  const [parsed, setParsed] = useState<string[][]>([]);
  const [validated, setValidated] = useState(false);
  const isAdmin = roles.includes("super_admin") || roles.includes("admin");

  const headers = parsed[0] ?? [];
  const dataRows = parsed.slice(1);
  const previewRows = useMemo(() => dataRows.slice(0, PREVIEW_ROWS), [dataRows]);
  const mismatchedRows = useMemo(
    () => dataRows.filter((row) => row.length !== headers.length).length,
    [dataRows, headers.length],
  );
  const duplicateHeaders = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    headers.forEach((header) => {
      const key = header.trim().toLowerCase();
      if (seen.has(key)) duplicates.add(header);
      seen.add(key);
    });
    return [...duplicates];
  }, [headers]);

  function analyzeCsv() {
    setError("");
    setValidated(false);
    if (!csvText.trim()) { setParsed([]); setError("الصق محتوى ملف CSV أولاً."); return; }
    if (csvText.length > MAX_CSV_CHARS) { setParsed([]); setError("حجم النص يتجاوز 2 ميغابايت. قسّم الملف إلى أجزاء أصغر."); return; }
    try {
      const rows = parseCsv(csvText.replace(/^\uFEFF/, ""));
      if (rows.length < 2) throw new Error("الملف يحتاج صف عناوين وصف بيانات واحد على الأقل.");
      if (rows[0]!.length > 200) throw new Error("عدد الأعمدة يتجاوز الحد المسموح (200).");
      if (rows.length > 5001) throw new Error("عدد الصفوف يتجاوز 5000 صف في المعاينة الواحدة.");
      setParsed(rows);
      setValidated(true);
    } catch (e) {
      setParsed([]);
      setError(e instanceof Error ? e.message : "تعذّر تحليل ملف CSV.");
    }
  }

  function clearAll() {
    setCsvText("");
    setParsed([]);
    setError("");
    setValidated(false);
  }

  if (loading) return <View style={s.center}><Text style={s.description}>جارٍ التحقق من الصلاحيات...</Text></View>;
  if (!session || !isAdmin) return <View style={s.center}><Text style={s.title}>{!session ? "سجّل الدخول" : "غير مصرّح"}</Text><Text style={s.description}>هذه الصفحة للمديرين المخوّلين فقط.</Text></View>;

  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: "استيراد البيانات" }} />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>مساعد استيراد البيانات</Text>
        <Text style={s.description}>الصق محتوى CSV لمعاينة العناوين والصفوف واكتشاف بعض مشاكل التنسيق قبل أي خطوة لاحقة. هذه الصفحة لا ترفع البيانات إلى قاعدة البيانات ولا تعدّل أي سجل.</Text>
        <Text style={s.label}>الجدول المقصود (للتنظيم فقط)</Text>
        <View style={s.tableChoices}>
          {TARGET_TABLES.map((table) => <Pressable key={table} onPress={() => setTargetTable(table)} style={[s.tableChip, targetTable === table && s.tableChipActive]}>
            <Text style={[s.tableChipText, targetTable === table && s.tableChipTextActive]}>{table}</Text>
          </Pressable>)}
        </View>
        <Text style={s.label}>محتوى ملف CSV</Text>
        <TextInput
          value={csvText}
          onChangeText={(value) => { setCsvText(value); setValidated(false); }}
          placeholder={'الصق هنا محتوى CSV\nمثال:\nid,full_name,phone\n...,..., ...'}
          placeholderTextColor={palette.muted}
          multiline
          textAlignVertical="top"
          autoCapitalize="none"
          style={s.input}
        />
        <Text style={s.hint}>يدعم الفواصل والنصوص المحاطة بعلامات اقتباس والاقتباس المكرر. الحد الأعلى 2 ميغابايت و5000 صف.</Text>
        <View style={s.actions}>
          <Pressable onPress={analyzeCsv} style={s.primary}><Text style={s.primaryText}>تحليل ومعاينة</Text></Pressable>
          <Pressable onPress={clearAll} style={s.secondary}><Text style={s.secondaryText}>مسح</Text></Pressable>
        </View>
        {!!error && <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>}
        {validated && <View style={s.result}>
          <Text style={s.section}>نتيجة المعاينة</Text>
          <View style={s.stats}>
            <View style={s.stat}><Text style={s.statValue}>{dataRows.length}</Text><Text style={s.statLabel}>صف بيانات</Text></View>
            <View style={s.stat}><Text style={s.statValue}>{headers.length}</Text><Text style={s.statLabel}>عمود</Text></View>
            <View style={s.stat}><Text style={s.statValue}>{mismatchedRows}</Text><Text style={s.statLabel}>صف مختلف الأعمدة</Text></View>
          </View>
          <Text style={s.description}>الجدول المحدد: <Text style={s.strong}>{targetTable}</Text> — هذا اختيار للمعاينة فقط ولا يعني أن الأعمدة متوافقة معه.</Text>
          {!!duplicateHeaders.length && <View style={s.warning}><Text style={s.warningText}>عناوين مكررة: {duplicateHeaders.join("، ")}</Text></View>}
          {mismatchedRows > 0 && <View style={s.warning}><Text style={s.warningText}>هناك {mismatchedRows} صفاً لا يطابق عدد الأعمدة في العنوان. راجع الملف قبل استخدامه.</Text></View>}
          <Text style={s.section}>عناوين الأعمدة</Text>
          <View style={s.headers}>{headers.map((header, index) => <View key={index} style={s.headerChip}><Text style={s.headerText}>{header || "(فارغ)"}</Text></View>)}</View>
          <Text style={s.section}>أول {previewRows.length} صفوف</Text>
          <ScrollView horizontal style={s.tableScroll}>
            <View>
              <View style={s.tableRow}>{headers.map((header, index) => <View key={index} style={[s.cell, s.headerCell]}><Text style={s.headerText}>{header}</Text></View>)}</View>
              {previewRows.map((row, rowIndex) => <View key={rowIndex} style={s.tableRow}>
                {headers.map((_, colIndex) => <View key={colIndex} style={s.cell}><Text style={s.cellText} numberOfLines={3}>{row[colIndex] ?? "—"}</Text></View>)}
              </View>)}
            </View>
          </ScrollView>
          <View style={s.notice}><Text style={s.noticeText}>تنبيه أمان: لا يوجد زر استيراد هنا. لم تُرسل بيانات الملف إلى أي خدمة ولم تتغير قاعدة البيانات. ربط الأعمدة والتحليل الذكي والتنفيذ الفعلي يحتاجان خطوة مستقلة مع مراجعة وتأكيد صريح.</Text></View>
        </View>}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page:{flex:1,backgroundColor: palette.pageCanvas},
  content:{padding:space.lg,gap:12,paddingBottom:48},
  center:{flex:1,justifyContent:"center",alignItems:"center",backgroundColor: palette.pageCanvas,padding:24,gap:10},
  title:{fontSize:21,fontWeight:"900",color:palette.ink,textAlign:"right"},
  description:{fontSize:12,color:palette.muted,textAlign:"right",lineHeight:21},
  label:{fontSize:13,fontWeight:"900",color:palette.ink,textAlign:"right"},
  input:{minHeight:180,maxHeight:300,borderWidth:1,borderColor:palette.line,borderRadius:radius.lg,padding:12,color:palette.ink,backgroundColor:palette.surface,fontSize:12,textAlign:"left"},
  hint:{fontSize:10,color:palette.muted,textAlign:"right",lineHeight:17},
  actions:{flexDirection:"row",gap:10},
  primary:{flex:1,minHeight:40,backgroundColor:palette.brand,paddingHorizontal:16,paddingVertical:8,borderRadius:16,alignItems:"center",justifyContent:"center"},
  primaryText:{color:"#FFFFFF",fontWeight:"900",fontSize:12},
  secondary:{padding:13,borderRadius:radius.md,borderWidth:1,borderColor:palette.line,alignItems:"center",minWidth:76},
  secondaryText:{color:palette.ink,fontWeight:"800",fontSize:12},
  tableChoices:{flexDirection:"row",flexWrap:"wrap",gap:7},
  tableChip:{borderWidth:1,borderColor:palette.line,borderRadius:20,paddingHorizontal:10,paddingVertical:7,backgroundColor:palette.surface},
  tableChipActive:{borderColor:palette.brand,backgroundColor:palette.brandSoft},
  tableChipText:{fontSize:10,color:palette.muted},
  tableChipTextActive:{color:palette.brand,fontWeight:"900"},
  errorBox:{backgroundColor:palette.dangerSoft,borderRadius:radius.md,padding:10},
  errorText:{fontSize:11,color:palette.danger,textAlign:"right"},
  result:{gap:10},
  section:{fontSize:15,fontWeight:"900",color:palette.ink,textAlign:"right",marginTop:5},
  stats:{flexDirection:"row",gap:8},
  stat:{flex:1,padding:10,borderRadius:radius.md,backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line},
  statValue:{fontSize:20,fontWeight:"900",color:palette.brand,textAlign:"right"},
  statLabel:{fontSize:9,color:palette.muted,textAlign:"right"},
  strong:{fontWeight:"900",color:palette.ink},
  warning:{padding:10,borderRadius:radius.md,backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line},
  warningText:{fontSize:11,color:palette.ink,textAlign:"right",lineHeight:18},
  headers:{flexDirection:"row",flexWrap:"wrap",gap:6},
  headerChip:{padding:7,borderRadius:radius.sm,backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line},
  headerText:{fontSize:10,fontWeight:"800",color:palette.ink},
  tableScroll:{maxHeight:280,borderWidth:1,borderColor:palette.line,borderRadius:radius.md},
  tableRow:{flexDirection:"row"},
  cell:{width:130,minHeight:42,justifyContent:"center",padding:7,borderRightWidth:1,borderBottomWidth:1,borderColor:palette.line,backgroundColor:palette.surface},
  headerCell:{backgroundColor:palette.brandSoft},
  cellText:{fontSize:10,color:palette.ink,textAlign:"left"},
  notice:{backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:radius.md,padding:11},
  noticeText:{fontSize:10,color:palette.muted,textAlign:"right",lineHeight:18},
});
