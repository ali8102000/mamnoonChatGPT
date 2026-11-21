import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, MapPin, Phone, RefreshCw, ShoppingCart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { MobileShell } from "@/components/mobile-shell";
import { toast } from "@/lib/toast";

type Business = { id: string; partner_type: string; business_name: string; phone: string; city: string; address: string; description: string | null };
type CatalogItem = { id: string; item_type: string; name: string; description: string | null; price_amount: number; currency: string; quantity_available: number | null; image_urls: string[] };
type CartLine = { id: string; catalog_item_id: string; quantity: number };

export const Route = createFileRoute("/partner/$id")({ ssr: false, component: PublicPartnerDetailsPage });

function PublicPartnerDetailsPage() {
  const { id } = Route.useParams();
  const { session } = useAuth();
  const [business, setBusiness] = useState<Business | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [cartBusy, setCartBusy] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [error, setError] = useState("");

  const loadCart = useCallback(async () => {
    if (!session?.user.id) { setCart([]); return; }
    const { data, error: cartError } = await (supabase as any).from("partner_customer_cart_items")
      .select("id,catalog_item_id,quantity").eq("customer_id", session.user.id)
      .eq("business_profile_id", id).order("created_at", { ascending: true });
    if (cartError) { setError("تعذر تحميل سلة التسوق حالياً."); return; }
    setCart((data ?? []) as CartLine[]);
  }, [id, session?.user.id]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const { data: profile, error: profileError } = await (supabase as any).from("partner_business_profiles")
      .select("id,partner_type,business_name,phone,city,address,description")
      .eq("id", id).eq("is_published", true).maybeSingle();
    if (profileError || !profile) { setBusiness(null); setCatalog([]); setError("المنشأة غير متاحة أو تم إيقاف نشرها."); setLoading(false); return; }
    setBusiness(profile as Business);
    const expectedType = profile.partner_type === "hotel" ? "room" : profile.partner_type === "restaurant" ? "menu_item" : "product";
    const { data, error: catalogError } = await (supabase as any).from("partner_catalog_items")
      .select("id,item_type,name,description,price_amount,currency,quantity_available,image_urls")
      .eq("business_profile_id", id).eq("item_type", expectedType).eq("is_active", true)
      .order("sort_order").order("created_at", { ascending: false });
    if (catalogError) setError("تعذر تحميل قائمة المحتويات حالياً.");
    setCatalog((data ?? []) as CatalogItem[]);
    setLoading(false);
    await loadCart();
  }, [id, loadCart]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadCart(); }, [loadCart]);

  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const cartSubtotal = useMemo(() => cart.reduce((sum, line) => {
    const item = catalog.find((entry) => entry.id === line.catalog_item_id);
    return sum + (item ? Number(item.price_amount) * line.quantity : 0);
  }, 0), [cart, catalog]);
  const cartCurrency = useMemo<string | null>(() => {
    const currencies = new Set<string>(cart.map((line) => catalog.find((entry) => entry.id === line.catalog_item_id)?.currency).filter((value): value is string => typeof value === "string" && value.length > 0));
    return currencies.size === 1 ? [...currencies][0] : null;
  }, [cart, catalog]);

  async function addToCart(item: CatalogItem) {
    if (!session?.user.id) { toast.error("سجّل الدخول حتى تضيف المنتجات إلى السلة."); return; }
    setCartBusy(true); setError("");
    const { error: addError } = await (supabase as any).rpc("add_partner_customer_cart_item", {
      p_business_profile_id: id, p_catalog_item_id: item.id, p_quantity: 1,
    });
    setCartBusy(false);
    if (addError) { toast.error(addError.message || "تعذر إضافة المنتج. تحقق من الكمية المتاحة."); return; }
    await loadCart();
    toast.success("انضاف المنتج إلى سلة التسوق");
  }

  async function setQuantity(line: CartLine, quantity: number) {
    if (!session?.user.id) return;
    if (quantity <= 0) {
      const { error: deleteError } = await (supabase as any).from("partner_customer_cart_items")
        .delete().eq("id", line.id).eq("customer_id", session.user.id);
      if (deleteError) toast.error(deleteError.message);
    } else {
      const item = catalog.find((entry) => entry.id === line.catalog_item_id);
      if (item?.quantity_available != null && quantity > item.quantity_available) { toast.error("الكمية المطلوبة أكبر من المخزون المتاح."); return; }
      const { error: updateError } = await (supabase as any).from("partner_customer_cart_items")
        .update({ quantity, updated_at: new Date().toISOString() }).eq("id", line.id).eq("customer_id", session.user.id);
      if (updateError) toast.error(updateError.message);
    }
    await loadCart();
  }

  async function submitOrder() {
    if (!session?.user.id) { toast.error("سجّل الدخول أولاً."); return; }
    if (!cart.length) { toast.error("أضف المنتجات قبل تأكيد الطلب."); return; }
    if (!deliveryAddress.trim()) { toast.error("اكتب عنوان التوصيل بالتفصيل."); return; }
    setCheckoutBusy(true);
    const { data: orderId, error: orderError } = await (supabase as any).rpc("place_partner_customer_order", {
      p_business_profile_id: id, p_delivery_address: deliveryAddress.trim(), p_customer_note: customerNote.trim() || null,
    });
    setCheckoutBusy(false);
    if (orderError || !orderId) { toast.error(orderError?.message || "تعذر إتمام الطلب. تحقق من توفر المنتجات."); await load(); return; }
    setDeliveryAddress(""); setCustomerNote("");
    await load();
    toast.success("تم إرسال طلبك للمنشأة. رقم الطلب: " + String(orderId).slice(0, 8));
  }

  const kind = business?.partner_type === "hotel" ? "الغرف" : business?.partner_type === "restaurant" ? "قائمة الطعام" : "المنتجات";

  return <MobileShell><main dir="rtl" className="mx-auto min-h-[75vh] max-w-3xl space-y-5 px-4 pb-12 pt-6">
    <Link to="/home" className="inline-flex items-center gap-2 text-sm font-black text-primary"><ArrowRight className="h-4 w-4"/> الرئيسية</Link>
    {loading ? <div className="rounded-2xl border p-8 text-center text-sm text-muted-foreground">جارٍ تحميل المحتويات...</div> : !business ? <div className="rounded-2xl border p-6 text-center text-sm text-destructive">{error || "المنشأة غير متاحة."}</div> : <>
      <section className="space-y-3 rounded-3xl bg-gradient-to-br from-primary to-primary-glow p-6 text-primary-foreground">
        <span className="text-xs font-bold opacity-80">{business.partner_type==="hotel"?"فندق":business.partner_type==="restaurant"?"مطعم":business.partner_type==="mall"?"مول":"متجر"}</span>
        <h1 className="text-2xl font-black">{business.business_name}</h1>
        <p className="flex items-center gap-2 text-xs opacity-90"><MapPin className="h-4 w-4"/>{business.city} · {business.address}</p>
        {business.description&&<p className="text-sm leading-7 opacity-90">{business.description}</p>}
        <a href={`tel:${business.phone}`} className="inline-flex w-fit items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-black text-primary"><Phone className="h-4 w-4"/> اتصال بالمنشأة</a>
      </section>
      <section><h2 className="text-xl font-black">{kind}</h2><p className="mt-1 text-xs text-muted-foreground">{catalog.length} عنصر متاح</p></section>
      {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
      {catalog.length===0 ? <div className="rounded-2xl border border-dashed p-7 text-center text-sm text-muted-foreground">ماكو {kind} مضافة حالياً. راح تظهر هنا من يضيفها صاحب المنشأة.</div> : <div className="grid gap-3 sm:grid-cols-2">{catalog.map(item=><article key={item.id} className="overflow-hidden rounded-2xl border border-border bg-card">
        {item.image_urls?.[0]&&<img src={item.image_urls[0]} alt={item.name} loading="lazy" className="h-44 w-full object-cover"/>}
        <div className="space-y-2 p-4"><h3 className="font-black">{item.name}</h3>{item.description&&<p className="text-xs leading-6 text-muted-foreground">{item.description}</p>}
          <div className="flex items-center justify-between gap-2"><strong className="text-sm text-primary">{Number(item.price_amount).toLocaleString("ar-IQ")} {item.currency==="USD"?"$":"د.ع"}</strong><span className="text-[11px] text-muted-foreground">{item.quantity_available===null?"متاح":item.quantity_available===0?"نفد حالياً":`المتاح: ${item.quantity_available}`}</span></div>
          {business.partner_type!=="hotel"&&<button type="button" disabled={cartBusy||item.quantity_available===0} onClick={()=>void addToCart(item)} className="w-full rounded-xl border-2 border-primary/60 bg-primary/5 p-3 text-xs font-black text-primary disabled:opacity-40">{cartBusy?"جارٍ الإضافة...":item.quantity_available===0?"نفد المخزون":"أضف إلى السلة +"}</button>}
        </div>
      </article>)}</div>}
      {business.partner_type!=="hotel"&&<section className="space-y-3 rounded-2xl border-2 border-primary/50 bg-card p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-black"><ShoppingCart className="h-5 w-5 text-primary"/> سلة التسوق · {cartCount} قطعة</h2>
        {cart.length===0?<p className="py-3 text-center text-xs text-muted-foreground">سلتك فارغة. أضف المنتجات حتى تكمل الطلب.</p>:<>
          <div className="divide-y divide-border">{cart.map(line=>{const item=catalog.find(entry=>entry.id===line.catalog_item_id);return <div key={line.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item?.name??"منتج غير متاح"}</p><p className="text-[11px] text-muted-foreground">{item?Number(item.price_amount).toLocaleString("ar-IQ")+" "+(item.currency==="USD"?"$":"د.ع"):""}</p></div>
            <div className="flex items-center gap-3"><button type="button" onClick={()=>void setQuantity(line,line.quantity-1)} className="h-8 w-8 rounded-lg border border-border text-lg font-black">−</button><b className="min-w-4 text-center">{line.quantity}</b><button type="button" onClick={()=>void setQuantity(line,line.quantity+1)} className="h-8 w-8 rounded-lg border border-primary/40 text-lg font-black text-primary">+</button></div>
          </div>;})}</div>
          <div className="flex items-center justify-between border-t border-border pt-3 text-sm"><b className="text-primary">{cartCurrency?cartSubtotal.toLocaleString("ar-IQ")+" "+(cartCurrency==="USD"?"$":"د.ع"):"عملات مختلفة"}</b><span className="font-black">المجموع التقديري</span></div>
          {!cartCurrency&&<p className="text-xs text-destructive">لا يمكن جمع منتجات بعملات مختلفة في سلة واحدة.</p>}
          <label className="block text-xs font-bold">عنوان التوصيل<input value={deliveryAddress} onChange={e=>setDeliveryAddress(e.target.value)} maxLength={500} placeholder="المحافظة، المنطقة، الشارع، أقرب نقطة دالة" className="input-base mt-1 w-full rounded-xl"/></label>
          <label className="block text-xs font-bold">ملاحظات للمنشأة<textarea value={customerNote} onChange={e=>setCustomerNote(e.target.value)} maxLength={1000} placeholder="ملاحظات إضافية (اختياري)" className="input-base mt-1 min-h-20 w-full rounded-xl"/></label>
          <button type="button" disabled={checkoutBusy||!cartCurrency} onClick={()=>void submitOrder()} className="w-full rounded-xl bg-primary p-3.5 text-sm font-black text-primary-foreground disabled:opacity-50">{checkoutBusy?"جارٍ تأكيد الطلب...":"تأكيد الطلب وإرساله للمنشأة"}</button>
        </>}
      </section>}
      <button onClick={()=>void load()} className="inline-flex items-center gap-2 text-xs font-bold text-primary"><RefreshCw className="h-3.5 w-3.5"/> تحديث المحتويات</button>
    </>}
  </main></MobileShell>;
}
