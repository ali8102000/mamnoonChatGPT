import { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { palette, radius, space } from "@/styles/theme";
import AdminVisualBuilderScreen from "./visual-builder";
import AdminBusinessCategoriesScreen from "./business-categories";
import AdminHomeBannersScreen from "./home-banners";
import CompanySettingsScreen from "./company";

type Tab = "visuals" | "categories" | "banners" | "identity";
const TABS: { id: Tab; title: string; detail: string; icon: string }[] = [
  { id: "visuals", title: "صور وأيقونات التطبيق", detail: "الرسوم وصور فئات التكسي", icon: "🖼️" },
  { id: "categories", title: "فئات المتاجر والمطاعم", detail: "الصور والأحجام والحركة", icon: "🛍️" },
  { id: "banners", title: "البانرات والإعلانات", detail: "صور الصفحة والحملات", icon: "🎞️" },
  { id: "identity", title: "هوية ممنون", detail: "الشعار وصور الشركة", icon: "🏢" },
];

export default function AdminImageStudioScreen() {
  const [active, setActive] = useState<Tab>("visuals");
  return <View style={styles.page}>
    <Stack.Screen options={{ title: "مركز الصور والتصميم" }} />
    <ScrollView contentContainerStyle={styles.content}>
      <LinearGradient colors={["#071B34","#12466A","#087E8B"]} start={{x:0,y:0}} end={{x:1,y:1}} style={styles.hero}>
        <View style={styles.heroIcon}><Text style={{fontSize:30}}>🎨</Text></View>
        <Text style={styles.eyebrow}>MAMNOON CREATIVE CONTROL</Text>
        <Text style={styles.heroTitle}>مركز الصور والتصميم</Text>
        <Text style={styles.heroText}>كل صور التطبيق ورسوماته بمكان واحد. اختار القسم وعدّل الصورة والحجم وإعدادات العرض والنشر.</Text>
        <View style={styles.art}>
          <View style={[styles.artBuilding,{height:40,width:52}]}><View style={styles.windows}><View style={styles.window}/><View style={styles.window}/><View style={styles.window}/><View style={styles.window}/></View></View>
          <View style={[styles.artBuilding,{height:68,width:64}]}><View style={styles.windows}><View style={styles.window}/><View style={styles.window}/><View style={styles.window}/><View style={styles.window}/><View style={styles.window}/><View style={styles.window}/></View></View>
          <View style={[styles.artBuilding,{height:50,width:50}]}><View style={styles.windows}><View style={styles.window}/><View style={styles.window}/><View style={styles.window}/><View style={styles.window}/></View></View>
          <View style={[styles.artBuilding,{height:32,width:42}]}><View style={styles.windows}><View style={styles.window}/><View style={styles.window}/></View></View>
        </View>
      </LinearGradient>
      <View style={styles.tabs}>
        {TABS.map(tab => <TouchableOpacity key={tab.id} onPress={()=>setActive(tab.id)} style={[styles.tab,active===tab.id&&styles.tabActive]}>
          <Text style={styles.tabIcon}>{tab.icon}</Text><View style={{flex:1}}><Text style={[styles.tabTitle,active===tab.id&&styles.tabTitleActive]}>{tab.title}</Text><Text style={[styles.tabDetail,active===tab.id&&styles.tabDetailActive]}>{tab.detail}</Text></View>
        </TouchableOpacity>)}
      </View>
      <View style={styles.editor}>
        {active==="visuals"&&<AdminVisualBuilderScreen/>}
        {active==="categories"&&<AdminBusinessCategoriesScreen/>}
        {active==="banners"&&<AdminHomeBannersScreen/>}
        {active==="identity"&&<CompanySettingsScreen/>}
      </View>
    </ScrollView>
  </View>;
}
const styles=StyleSheet.create({
 page:{flex:1,backgroundColor:palette.pageCanvas},content:{padding:space.md,paddingBottom:48,gap:14},
 hero:{borderRadius:26,padding:18,overflow:"hidden",elevation:7,shadowColor:"#06213b",shadowOpacity:.2,shadowRadius:16,shadowOffset:{width:0,height:8}},
 heroIcon:{width:56,height:56,borderRadius:18,backgroundColor:"rgba(255,255,255,.13)",borderWidth:1,borderColor:"rgba(255,255,255,.2)",alignItems:"center",justifyContent:"center",marginBottom:10},
 eyebrow:{color:"#B5F7EE",fontSize:9,fontWeight:"900",letterSpacing:1,textAlign:"right"},
 heroTitle:{color:"#FFFFFF",fontSize:24,fontWeight:"900",textAlign:"right",marginTop:4},
 heroText:{color:"#D9F5FA",fontSize:12,lineHeight:20,textAlign:"right",marginTop:8},
 art:{height:92,flexDirection:"row",alignItems:"flex-end",justifyContent:"space-around",paddingHorizontal:10,marginTop:14,borderRadius:16,backgroundColor:"rgba(255,255,255,.08)",borderWidth:1,borderColor:"rgba(255,255,255,.14)"},
 artBuilding:{borderTopLeftRadius:9,borderTopRightRadius:9,backgroundColor:"rgba(255,255,255,.2)",padding:7,justifyContent:"flex-start"},
 windows:{flexDirection:"row",flexWrap:"wrap",gap:5},window:{width:10,height:10,backgroundColor:"#BDF7F0",borderRadius:2},
 tabs:{gap:8},tab:{flexDirection:"row",alignItems:"center",gap:10,padding:12,borderRadius:16,borderWidth:1,borderColor:"#DCE8F0",backgroundColor:palette.surface,minHeight:66},
 tabActive:{backgroundColor:"#E1F6F7",borderColor:"#18A6B2",borderWidth:1.5},
 tabIcon:{fontSize:24,width:34,textAlign:"center"},tabTitle:{fontSize:12,fontWeight:"900",color:palette.ink,textAlign:"right"},
 tabTitleActive:{color:"#075B70"},tabDetail:{fontSize:10,color:palette.muted,textAlign:"right",marginTop:3},tabDetailActive:{color:"#267889"},
 editor:{backgroundColor:palette.surface,borderRadius:18,padding:4,borderWidth:1,borderColor:palette.line}
});
