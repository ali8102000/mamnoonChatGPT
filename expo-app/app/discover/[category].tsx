import {useCallback,useEffect,useState} from "react";
import {ActivityIndicator,Image,Pressable,ScrollView,Text,View} from "react-native";
import {router,useLocalSearchParams} from "expo-router";
import {supabase} from "@/lib/supabase";
import {palette,radius,space} from "@/styles/theme";
import * as Location from "expo-location";
type PartnerType="hotel"|"restaurant"|"store"|"mall";
type Business={id:string;partner_type:PartnerType;business_name:string;city:string;address:string;description:string|null};
type Product={id:string;name:string;description:string|null;price_amount:number;currency:string;image_urls:string[];profile:{id:string;business_name:string;city:string;address:string;business_vertical:string;governorate_key:string;promotion_governorates:string[];promotion_radius_km:number;promotion_latitude:number|null;promotion_longitude:number|null}};
export default function DiscoverCategoryScreen(){
 const {category:rawParam}=useLocalSearchParams<{category:string}>();const raw=String(rawParam??"");
 const isStore=raw.startsWith("store-"),isRestaurant=raw.startsWith("restaurant-"),isGrocery=raw==="grocery";
 const categoryKey=isStore?raw.slice(6):isRestaurant?raw.slice(11):isGrocery?"grocery":null;
 const [title,setTitle]=useState(isGrocery?"بقالة وخضروات":isStore?"المتاجر":isRestaurant?"المطاعم":raw==="store"?"المتاجر":raw==="restaurant"?"المطاعم":raw==="hotel"?"الفنادق":"اكتشاف");
 const [items,setItems]=useState<Business[]>([]);const [products,setProducts]=useState<Product[]>([]);
 const [loading,setLoading]=useState(true);const [error,setError]=useState("");
 const load=useCallback(async()=>{
  setLoading(true);setError("");
  if(categoryKey){
   const [{data:userData},cat]=await Promise.all([supabase.auth.getUser(),(supabase as any).from("partner_catalog_categories").select("title").eq("category_key",categoryKey).maybeSingle()]);
   let customerGovernorate:string|null=null;
   if(userData.user?.id){const profileResult=await (supabase as any).from("profiles").select("governorate_key").eq("id",userData.user.id).maybeSingle();customerGovernorate=profileResult.data?.governorate_key??null;}
   let customerLocation:{latitude:number;longitude:number}|null=null;
   if(isGrocery){try{let permission=await Location.getForegroundPermissionsAsync();if(!permission.granted)permission=await Location.requestForegroundPermissionsAsync();if(permission.granted){const point=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});customerLocation={latitude:point.coords.latitude,longitude:point.coords.longitude};}}catch{}}
   const rows=await (supabase as any).from("partner_catalog_items").select("id,name,description,price_amount,currency,image_urls,profile:partner_business_profiles!inner(id,business_name,city,address,business_vertical,governorate_key,promotion_governorates,promotion_radius_km,promotion_latitude,promotion_longitude)").eq("category_key",categoryKey).eq("is_active",true).eq("profile.is_published",true).order("created_at",{ascending:false});
   if(cat.data?.title)setTitle(cat.data.title);if(rows.error)setError("تعذر تحميل المنتجات حالياً.");
   let visible=(rows.data??[]) as Product[];
   if(isStore||isRestaurant){if(!customerGovernorate)setError("حدد محافظتك من ملفك الشخصي حتى نعرض لك المحلات والمطاعم ضمن نطاق محافظتك.");visible=visible.filter(p=>(p.profile.promotion_governorates??[]).includes(customerGovernorate??""));}
   if(isGrocery){
    const distanceKm=(a:number,b:number,c:number,d:number)=>{const rad=(v:number)=>v*Math.PI/180;const x=rad(c-a),y=rad(d-b);const h=Math.sin(x/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(y/2)**2;return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));};
    visible=customerLocation?visible.filter(p=>p.profile.business_vertical==="grocery"&&p.profile.promotion_latitude!=null&&p.profile.promotion_longitude!=null&&distanceKm(customerLocation!.latitude,customerLocation!.longitude,p.profile.promotion_latitude!,p.profile.promotion_longitude!)<=Number(p.profile.promotion_radius_km||5)): [];
    if(!customerLocation)setError("فعّل موقع الجهاز حتى نعرض البقالات القريبة ضمن نطاقها الجغرافي.");
   }
   setProducts(visible);setItems([]);setLoading(false);return;
  }
  const types:PartnerType[]=raw==="restaurant"?["restaurant"]:raw==="hotel"?["hotel"]:raw==="store"?["store","mall"]:[];
  if(!types.length){setError("هذا القسم غير متاح.");setLoading(false);return;}
  let query=(supabase as any).from("partner_business_profiles").select("id,partner_type,business_name,city,address,description").eq("is_published",true).in("partner_type",types);
  if(raw==="store")query=query.eq("business_vertical","store");
  const {data,error:queryError}=await query.order("business_name");if(queryError)setError("تعذر تحميل المنشآت حالياً.");
  setItems((data??[]) as Business[]);setProducts([]);setLoading(false);
 },[raw,categoryKey]);
 useEffect(()=>{void load();},[load]);
 return <ScrollView style={{flex:1,backgroundColor:palette.pageCanvas}} contentContainerStyle={{padding:space.lg,paddingBottom:48,gap:14}}>
  <Pressable onPress={()=>router.back()} style={{alignSelf:"flex-start",paddingVertical:8}}><Text style={{color:palette.brand,fontWeight:"900"}}>→ رجوع</Text></Pressable>
  <View style={{backgroundColor:palette.brand,borderRadius:radius.xl,padding:20,gap:6}}><Text style={{color:"#fff",fontSize:24,fontWeight:"900",textAlign:"right"}}>{title}</Text><Text style={{color:"#fff",opacity:.9,fontSize:12,textAlign:"right"}}>{categoryKey?"المنتجات المنشورة ضمن هذه الفئة فقط":"تصفح المنشآت والمحتويات المتاحة."}</Text><Text style={{color:"#fff",opacity:.8,fontSize:11,textAlign:"right"}}>{categoryKey?products.length:items.length} {categoryKey?"منتج":"منشأة"}</Text></View>
  {loading?<ActivityIndicator color={palette.brand} style={{marginTop:30}}/>:error?<View style={{backgroundColor:palette.surface,borderRadius:radius.lg,padding:18,gap:10}}><Text style={{color:palette.danger,textAlign:"right"}}>{error}</Text><Pressable onPress={()=>void load()}><Text style={{color:palette.brand,fontWeight:"900",textAlign:"right"}}>إعادة المحاولة</Text></Pressable></View>:categoryKey?(products.length===0?<View style={{backgroundColor:palette.surface,borderRadius:radius.lg,padding:22}}><Text style={{color:palette.ink,fontWeight:"900",textAlign:"center"}}>ماكو منتجات منشورة بهذه الفئة حالياً</Text></View>:<View style={{gap:12}}>{products.map(p=><Pressable key={p.id} onPress={()=>router.push({pathname:"/partner/[id]",params:{id:p.profile.id}})} style={{backgroundColor:palette.surface,borderRadius:radius.lg,borderWidth:1,borderColor:palette.line,overflow:"hidden"}}>{p.image_urls?.[0]?<Image source={{uri:p.image_urls[0]}} style={{width:"100%",height:170}} resizeMode="cover"/>:null}<View style={{padding:14,gap:6}}><Text style={{color:palette.ink,fontSize:15,fontWeight:"900",textAlign:"right"}}>{p.name}</Text>{p.description?<Text style={{color:palette.muted,fontSize:11,textAlign:"right"}}>{p.description}</Text>:null}<Text style={{color:palette.brand,fontWeight:"900",textAlign:"right"}}>{Number(p.price_amount).toLocaleString("ar-IQ")} {p.currency==="USD"?"$":"د.ع"}</Text><Text style={{color:palette.muted,fontSize:10,textAlign:"right"}}>{p.profile.business_name} · {p.profile.city}</Text></View></Pressable>)}</View>):items.length===0?<View style={{backgroundColor:palette.surface,borderRadius:radius.lg,padding:22}}><Text style={{color:palette.ink,fontWeight:"900",textAlign:"center"}}>ماكو منشآت منشورة حالياً</Text></View>:items.map(item=><Pressable key={item.id} onPress={()=>router.push({pathname:"/partner/[id]",params:{id:item.id}})} style={{backgroundColor:palette.surface,borderRadius:radius.lg,borderWidth:1,borderColor:palette.line,padding:16,gap:7}}><Text style={{color:palette.ink,fontSize:17,fontWeight:"900",textAlign:"right"}}>{item.business_name}</Text><Text style={{color:palette.muted,fontSize:12,textAlign:"right"}}>📍 {item.city} · {item.address}</Text>{item.description?<Text style={{color:palette.muted,fontSize:12,textAlign:"right"}}>{item.description}</Text>:null}<Text style={{color:palette.brand,fontSize:12,fontWeight:"900",textAlign:"right"}}>عرض المحتويات ←</Text></Pressable>)}
 </ScrollView>;
}
