import { Stack, router } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { palette, radius, space } from "@/styles/theme";

export default function SubscriptionsScreen() {
  return <View style={s.page}>
    <Stack.Screen options={{title:"نظام العمولات"}}/>
    <View style={s.card}>
      <View style={s.icon}><Text style={{fontSize:30}}>💰</Text></View>
      <Text style={s.title}>ممنون بدون اشتراكات</Text>
      <Text style={s.body}>ماكو باقات أو اشتراكات شهرية وسنوية. استخدام ممنون يعتمد على العمولات والاستقطاعات التي تحددها الإدارة حسب نوع الخدمة والمحافظة، وتظهر المبالغ المستحقة داخل المحفظة.</Text>
      <TouchableOpacity onPress={()=>router.replace("/home")} style={s.button}><Text style={s.buttonText}>الرجوع للتطبيق</Text></TouchableOpacity>
    </View>
  </View>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:palette.pageCanvas,justifyContent:"center",padding:space.lg},card:{backgroundColor:palette.surface,borderColor:palette.line,borderWidth:1,borderRadius:radius.xl,padding:22,alignItems:"center",gap:14},icon:{width:64,height:64,borderRadius:20,backgroundColor:palette.brandSoft,alignItems:"center",justifyContent:"center"},title:{fontSize:20,fontWeight:"900",color:palette.ink},body:{fontSize:13,lineHeight:23,color:palette.muted,textAlign:"center"},button:{backgroundColor:palette.brand,borderRadius:radius.md,paddingHorizontal:24,paddingVertical:13},buttonText:{color:palette.white,fontWeight:"900",fontSize:12}});
