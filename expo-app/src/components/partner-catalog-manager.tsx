import { useCallback, useEffect, useState } from "react";
import { View,Text,TextInput,TouchableOpacity,ActivityIndicator,Alert,Switch,StyleSheet } from "react-native";
import { supabase } from "@/lib/supabase";
import { palette,radius,space } from "@/styles/theme";
type PartnerType="hotel"|"restaurant"|"store"|"mall";
type Category={category_key:string;title:string;vertical:string};
type CatalogItem={id:string;name:string;description:string|null;price_amount:number;currency:"IQD"|"USD";quantity_available:number|null;is_active:boolean;category_key:string|null};
export function PartnerCatalogManager({profileId,partnerType,businessVertical="store"}:{profileId:string;partnerType:PartnerType;businessVertical?:"store"|"grocery"|"restaurant"}) {
 const itemType=partnerType==="hotel"?"room":partnerType==="restaurant"?"menu_item":"product";
 const vertical=partnerType==="restaurant"?"restaurant":partnerType==="hotel"?"":businessVertical;
 const grocery=vertical==="grocery";
 const [categories,setCategories]=useState<Category[]>([]);const [categoryKey,setCategoryKey]=useState("");
 const [items,setItems]=useState<CatalogItem[]>([]);
 const [name,setName]=useState("");const [description,setDescription]=useState("");const [price,setPrice]=useState("");const [currency,setCurrency]=useState<"IQD"|"USD">("IQD");const [quantity,setQuantity]=useState("");
 const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);
 const load=useCallback(async()=>{
  setLoading(true);
  const [cats,rows]=await Promise.all([
   vertical?(supabase as any).from("partner_catalog_categories").select("category_key,title,vertical").eq("vertical",vertical).eq("is_active",true).order("sort_order"):Promise.resolve({data:[],error:null}),
   (supabase as any).from("partner_catalog_items").select("id,name,description,price_amount,currency,quantity_available,is_active,category_key").eq("business_profile_id",profileId).eq("item_type",itemType).order("sort_order").order("created_at",{ascending:false})
  ]);
  if(cats.error)Alert.alert("تعذر تحميل الفئات",cats.error.message);else{setCategories(cats.data??[]);if(cats.data?.length)setCategoryKey(current=>current||cats.data[0].category_key);}
  if(rows.error)Alert.alert("تعذر تحميل الكتالوج",rows.error.message);
  setItems((rows.data??[]) as CatalogItem[]);setLoading(false);
 },[profileId,itemType,vertical]);
 useEffect(()=>{void load();},[load]);
 const add=async()=>{
  if(name.trim().length<2||price.trim()===""||!Number.isFinite(Number(price))||Number(price)<0||(itemType!=="room"&&!grocery&&!categoryKey)){Alert.alert("بيانات غير مكتملة","اكتب الاسم والسعر وحدد الفئة.");return;}
  setSaving(true);
  const {error}=await (supabase as any).from("partner_catalog_items").insert({business_profile_id:profileId,item_type:itemType,category_key:itemType==="room"?null:grocery?"grocery":categoryKey,name:name.trim(),description:description.trim()||null,price_amount:Number(price),currency,quantity_available:quantity.trim()===""?null:Number(quantity),is_active:true});
  setSaving(false);if(error){Alert.alert("تعذر الإضافة",error.message);return;}
  setName("");setDescription("");setPrice("");setQuantity("");await load();
 };
 const toggle=async(item:CatalogItem)=>{const {error}=await (supabase as any).from("partner_catalog_items").update({is_active:!item.is_active,updated_at:new Date().toISOString()}).eq("id",item.id).eq("business_profile_id",profileId);if(error)Alert.alert("تعذر التحديث",error.message);else await load();};
 const remove=(item:CatalogItem)=>Alert.alert("حذف العنصر",`تريد تحذف «${item.name}»؟`,[{text:"رجوع",style:"cancel"},{text:"حذف",style:"destructive",onPress:async()=>{const {error}=await (supabase as any).from("partner_catalog_items").delete().eq("id",item.id).eq("business_profile_id",profileId);if(error)Alert.alert("تعذر الحذف",error.message);else await load();}}]);
 const categoryName=(key:string|null)=>categories.find(c=>c.category_key===key)?.title??(key==="grocery"?"بقالة وخضروات":"بدون تصنيف");
 return <View style={s.box}>
  <View style={s.head}><Text style={s.title}>إدارة {itemType==="room"?"الغرف":itemType==="menu_item"?"قائمة الطعام":"المنتجات"}</Text><TouchableOpacity onPress={()=>void load()}><Text style={s.refresh}>تحديث</Text></TouchableOpacity></View>
  {itemType!=="room"?<View style={s.categoryBox}><Text style={s.label}>{grocery?"قسم البقالة المستقل":"وين تحب نعرض ونروّج هذا المنتج؟"}</Text>{grocery?<Text style={s.note}>منتجاتك تظهر بقسم البقالة فقط، وما تدخل باقتراحات المحلات أو المطاعم.</Text>:categories.map(c=><TouchableOpacity key={c.category_key} onPress={()=>setCategoryKey(c.category_key)} style={[s.category,categoryKey===c.category_key&&s.categorySelected]}><Text style={[s.categoryText,categoryKey===c.category_key&&{color:"#fff"}]}>{c.title}</Text></TouchableOpacity>)}</View>:null}
  <Text style={s.label}>اسم العنصر</Text><TextInput value={name} onChangeText={setName} maxLength={140} style={s.input}/>
  <Text style={s.label}>الوصف</Text><TextInput value={description} onChangeText={setDescription} multiline maxLength={1000} style={[s.input,s.multi]}/>
  <Text style={s.label}>السعر</Text><TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" style={s.input}/>
  <View style={s.row}><TouchableOpacity onPress={()=>setCurrency(v=>v==="IQD"?"USD":"IQD")} style={s.currency}><Text style={s.currencyText}>{currency==="IQD"?"دينار عراقي":"دولار"}</Text></TouchableOpacity><View style={{flex:1}}><Text style={s.label}>الكمية</Text><TextInput value={quantity} onChangeText={setQuantity} keyboardType="number-pad" style={s.input}/></View></View>
  <TouchableOpacity disabled={saving} onPress={()=>void add()} style={[s.add,saving&&{opacity:.5}]}><Text style={s.addText}>{saving?"جارٍ الإضافة...":"إضافة عنصر"}</Text></TouchableOpacity>
  {loading?<ActivityIndicator color={palette.brand}/>:items.length===0?<Text style={s.empty}>ماكو عناصر مضافة حالياً.</Text>:items.map(item=><View key={item.id} style={s.item}><View style={{flex:1}}><Text style={s.itemName}>{item.name}</Text><Text style={s.meta}>{categoryName(item.category_key)} · {Number(item.price_amount).toLocaleString("en-US")} {item.currency}</Text></View><View style={s.actions}><Switch value={item.is_active} onValueChange={()=>void toggle(item)} trackColor={{true:palette.brand}}/><TouchableOpacity onPress={()=>remove(item)}><Text style={s.delete}>حذف</Text></TouchableOpacity></View></View>)}
 </View>;
}
const s=StyleSheet.create({box:{borderWidth:1,borderColor:palette.line,borderRadius:radius.lg,padding:12,gap:8,backgroundColor:palette.pageCanvas},head:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},title:{fontSize:14,fontWeight:"900",color:palette.ink,textAlign:"right"},refresh:{fontSize:11,color:palette.brand,fontWeight:"900"},label:{fontSize:11,color:palette.ink,fontWeight:"800",textAlign:"right"},input:{borderWidth:1,borderColor:palette.line,borderRadius:radius.md,padding:9,color:palette.ink,textAlign:"right",backgroundColor:palette.surface,fontSize:12},multi:{minHeight:58,textAlignVertical:"top"},row:{flexDirection:"row",gap:8,alignItems:"flex-end"},currency:{padding:10,borderRadius:radius.md,backgroundColor:palette.brandSoft,marginBottom:2},currencyText:{fontSize:10,color:palette.brand,fontWeight:"800"},add:{backgroundColor:palette.brand,padding:12,borderRadius:radius.md,alignItems:"center"},addText:{color:"#fff",fontSize:12,fontWeight:"900"},empty:{fontSize:11,color:palette.muted,textAlign:"center",padding:8},item:{flexDirection:"row",alignItems:"center",gap:8,borderTopWidth:1,borderColor:palette.line,paddingTop:9},itemName:{fontSize:12,fontWeight:"900",color:palette.ink,textAlign:"right"},meta:{fontSize:10,color:palette.muted,textAlign:"right",marginTop:3},actions:{alignItems:"center",gap:3},delete:{fontSize:10,color:"#dc2626",fontWeight:"800",padding:4},categoryBox:{backgroundColor:palette.brandSoft,borderRadius:radius.md,padding:9,gap:6},category:{borderWidth:1,borderColor:palette.line,borderRadius:9,padding:9,backgroundColor:palette.surface},categorySelected:{backgroundColor:palette.brand,borderColor:palette.brand},categoryText:{color:palette.ink,fontSize:11,fontWeight:"800",textAlign:"right"},note:{fontSize:10,color:palette.muted,textAlign:"right",lineHeight:17}});
