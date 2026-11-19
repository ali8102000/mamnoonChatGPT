import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, Switch, StyleSheet } from "react-native";
import { supabase } from "@/lib/supabase";
import { palette, radius, space } from "@/styles/theme";

type PartnerType="hotel"|"restaurant"|"store"|"mall";
type CatalogItem={id:string;name:string;description:string|null;price_amount:number;currency:"IQD"|"USD";quantity_available:number|null;is_active:boolean};
export function PartnerCatalogManager({profileId,partnerType}:{profileId:string;partnerType:PartnerType}) {
  const itemType=partnerType==="hotel"?"room":partnerType==="restaurant"?"menu_item":"product";
  const title=itemType==="room"?"الغرف":itemType==="menu_item"?"قائمة الطعام":"المنتجات";
  const [items,setItems]=useState<CatalogItem[]>([]);
  const [name,setName]=useState("");const [description,setDescription]=useState("");
  const [price,setPrice]=useState("");const [currency,setCurrency]=useState<"IQD"|"USD">("IQD");
  const [quantity,setQuantity]=useState("");const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);
  const load=useCallback(async()=>{
    setLoading(true);
    const {data,error}=await (supabase as any).from("partner_catalog_items").select("id,name,description,price_amount,currency,quantity_available,is_active").eq("business_profile_id",profileId).eq("item_type",itemType).order("sort_order").order("created_at",{ascending:false});
    if(error)Alert.alert("تعذر تحميل الكتالوج",error.message);
    setItems((data??[]) as CatalogItem[]);setLoading(false);
  },[profileId,itemType]);
  useEffect(()=>{void load();},[load]);
  const add=async()=>{
    if(name.trim().length<2||price.trim()===""||!Number.isFinite(Number(price))||Number(price)<0||(quantity.trim()!==""&&(!Number.isInteger(Number(quantity))||Number(quantity)<0))){Alert.alert("بيانات غير مكتملة","اكتب الاسم والسعر والكمية بصورة صحيحة.");return;}
    setSaving(true);
    const {error}=await (supabase as any).from("partner_catalog_items").insert({business_profile_id:profileId,item_type:itemType,name:name.trim(),description:description.trim()||null,price_amount:Number(price),currency,quantity_available:quantity.trim()===""?null:Number(quantity),is_active:true});
    setSaving(false);
    if(error){Alert.alert("تعذر الإضافة",error.message);return;}
    setName("");setDescription("");setPrice("");setQuantity("");await load();
  };
  const toggle=async(item:CatalogItem)=>{
    const {error}=await (supabase as any).from("partner_catalog_items").update({is_active:!item.is_active,updated_at:new Date().toISOString()}).eq("id",item.id).eq("business_profile_id",profileId);
    if(error){Alert.alert("تعذر التحديث",error.message);return;}await load();
  };
  const remove=(item:CatalogItem)=>Alert.alert("حذف العنصر",`تريد تحذف «${item.name}»؟`,[{text:"رجوع",style:"cancel"},{text:"حذف",style:"destructive",onPress:async()=>{const {error}=await (supabase as any).from("partner_catalog_items").delete().eq("id",item.id).eq("business_profile_id",profileId);if(error)Alert.alert("تعذر الحذف",error.message);else await load();}}]);
  return <View style={s.box}>
    <View style={s.head}><Text style={s.title}>إدارة {title}</Text><TouchableOpacity onPress={()=>void load()}><Text style={s.refresh}>تحديث</Text></TouchableOpacity></View>
    <Text style={s.label}>اسم العنصر</Text><TextInput value={name} onChangeText={setName} maxLength={140} style={s.input}/>
    <Text style={s.label}>الوصف</Text><TextInput value={description} onChangeText={setDescription} multiline maxLength={1000} style={[s.input,s.multi]}/>
    <Text style={s.label}>السعر</Text><TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" style={s.input}/>
    <View style={s.row}><TouchableOpacity onPress={()=>setCurrency(v=>v==="IQD"?"USD":"IQD")} style={s.currency}><Text style={s.currencyText}>{currency==="IQD"?"دينار عراقي (اضغط للتبديل)":"دولار (اضغط للتبديل)"}</Text></TouchableOpacity><View style={{flex:1}}><Text style={s.label}>الكمية (فارغة = مفتوحة)</Text><TextInput value={quantity} onChangeText={setQuantity} keyboardType="number-pad" style={s.input}/></View></View>
    <TouchableOpacity disabled={saving} onPress={()=>void add()} style={[s.add,saving&&{opacity:.5}]}><Text style={s.addText}>{saving?"جارٍ الإضافة...":"إضافة عنصر"}</Text></TouchableOpacity>
    {loading?<ActivityIndicator color={palette.brand}/>:items.length===0?<Text style={s.empty}>ماكو عناصر مضافة حالياً.</Text>:items.map(item=><View key={item.id} style={s.item}><View style={{flex:1}}><Text style={s.itemName}>{item.name}</Text><Text style={s.meta}>{Number(item.price_amount).toLocaleString("en-US")} {item.currency} · {item.quantity_available===null?"كمية مفتوحة":`المتاح ${item.quantity_available}`}</Text></View><View style={s.actions}><Switch value={item.is_active} onValueChange={()=>void toggle(item)} trackColor={{true:palette.brand}}/><TouchableOpacity onPress={()=>remove(item)}><Text style={s.delete}>حذف</Text></TouchableOpacity></View></View>)}
    <Text style={s.note}>رفع الصور وتعديل بيانات العنصر بعد الإضافة وربطه بدليل الزبائن ضمن المرحلة التالية.</Text>
  </View>;
}
const s=StyleSheet.create({box:{borderWidth:1,borderColor:palette.line,borderRadius:radius.lg,padding:12,gap:8,backgroundColor:palette.pageCanvas},head:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},title:{fontSize:14,fontWeight:"900",color:palette.ink,textAlign:"right"},refresh:{fontSize:11,color:palette.brand,fontWeight:"900"},label:{fontSize:11,color:palette.ink,fontWeight:"800",textAlign:"right"},input:{borderWidth:1,borderColor:palette.line,borderRadius:radius.md,padding:9,color:palette.ink,textAlign:"right",backgroundColor:palette.surface,fontSize:12},multi:{minHeight:58,textAlignVertical:"top"},row:{flexDirection:"row",gap:8,alignItems:"flex-end"},currency:{padding:10,borderRadius:radius.md,backgroundColor:palette.brandSoft,marginBottom:2},currencyText:{fontSize:10,color:palette.brand,fontWeight:"800"},add:{backgroundColor:palette.brand,padding:12,borderRadius:radius.md,alignItems:"center"},addText:{color:"#fff",fontSize:12,fontWeight:"900"},empty:{fontSize:11,color:palette.muted,textAlign:"center",padding:8},item:{flexDirection:"row",alignItems:"center",gap:8,borderTopWidth:1,borderColor:palette.line,paddingTop:9},itemName:{fontSize:12,fontWeight:"900",color:palette.ink,textAlign:"right"},meta:{fontSize:10,color:palette.muted,textAlign:"right",marginTop:3},actions:{alignItems:"center",gap:3},delete:{fontSize:10,color:"#dc2626",fontWeight:"800",padding:4},note:{fontSize:9,color:palette.muted,textAlign:"right",lineHeight:16}});
