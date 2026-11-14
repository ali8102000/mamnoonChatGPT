import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const b64url=(s:string)=>s.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(s.length/4)*4,"=");
function decodePart(s:string){return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64url(s)),c=>c.charCodeAt(0))));}
async function verifyHs256(token:string,secret:string){
  const parts=token.split("."); if(parts.length!==3) throw new Error("invalid_jwt");
  const header=decodePart(parts[0]); if(header.alg!=="HS256") throw new Error("invalid_jwt_alg");
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  const signature=Uint8Array.from(atob(b64url(parts[2])),c=>c.charCodeAt(0));
  const valid=await crypto.subtle.verify("HMAC",key,signature,new TextEncoder().encode(parts[0]+"."+parts[1]));
  if(!valid) throw new Error("invalid_jwt_signature");
  const payload=decodePart(parts[1]); const now=Math.floor(Date.now()/1000);
  if(payload.exp && now>=payload.exp) throw new Error("expired_jwt");
  if(payload.nbf && now<payload.nbf) throw new Error("premature_jwt");
  return payload;
}
async function gatewayToken(baseUrl:string,clientId:string,clientSecret:string){
 const body=new URLSearchParams({grant_type:"client_credentials",client_id:clientId,client_secret:clientSecret,scope:"payment:read payment:write"});
 const res=await fetch(baseUrl+"/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
 const data=await res.json().catch(()=>({})); if(!res.ok||!data.access_token) throw new Error("oauth_failed"); return data.access_token as string;
}
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST") return json({error:"method_not_allowed"},405);
 try{
  const apiKey=Deno.env.get("ZAINCASH_API_KEY"); const clientId=Deno.env.get("ZAINCASH_CLIENT_ID"); const clientSecret=Deno.env.get("ZAINCASH_CLIENT_SECRET");
  const url=Deno.env.get("SUPABASE_URL"); const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const base=(Deno.env.get("ZAINCASH_BASE_URL")||"https://pg-api-uat.zaincash.iq").replace(/\/$/,"");
  if(!apiKey||!clientId||!clientSecret||!url||!serviceKey) return json({error:"payment_configuration_incomplete"},503);
  const body=await req.json().catch(()=>null); if(typeof body?.webhook_token!=="string") return json({error:"missing_webhook_token"},400);
  const claims=await verifyHs256(body.webhook_token,apiKey);
  const data=claims.data||{};
  const eventId=claims.eventId; const transactionId=data.transactionId; const reference=data.merchantReferenceId;
  if(typeof eventId!=="string"||typeof transactionId!=="string"||typeof reference!=="string") return json({error:"invalid_webhook_claims"},400);
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:payment,error:paymentError}=await admin.from("payment_transactions").select("id,amount,currency,external_reference_id,status,gateway_transaction_id").eq("external_reference_id",reference).maybeSingle();
  if(paymentError||!payment) return json({error:"payment_not_found"},404);
  if(payment.status==="paid") return json({ok:true,duplicate:true});
  if(payment.gateway_transaction_id && payment.gateway_transaction_id!==transactionId) return json({error:"transaction_mismatch"},409);
  const token=await gatewayToken(base,clientId,clientSecret);
  const inquiryRes=await fetch(base+"/api/v2/payment-gateway/transaction/inquiry/"+encodeURIComponent(transactionId),{headers:{Authorization:"Bearer "+token}});
  const inquiry=await inquiryRes.json().catch(()=>({}));
  if(!inquiryRes.ok) return json({error:"inquiry_failed"},502);
  const details=inquiry.transactionDetails||{};
  if(details.transactionId!==transactionId || details.externalReferenceId!==reference) return json({error:"inquiry_reference_mismatch"},409);
  const confirmedAmount=Number(details.amount?.value);
  const currency=details.amount?.currency;
  if(confirmedAmount!==payment.amount||currency!=="IQD") return json({error:"inquiry_amount_mismatch"},409);
  const eventInsert=await admin.from("zaincash_webhook_events").insert({event_id:eventId,transaction_id:transactionId,payload:{eventType:claims.eventType,status:inquiry.status}});
  if(eventInsert.error?.code==="23505") return json({ok:true,duplicate:true});
  if(eventInsert.error) return json({error:"event_record_failed"},500);
  if(inquiry.status==="SUCCESS"){
    const {error}=await admin.rpc("finalize_zaincash_payment",{p_payment_id:payment.id,p_gateway_transaction_id:transactionId,p_gateway_status:"SUCCESS",p_confirmed_amount:confirmedAmount,p_currency:currency,p_payload:{eventId,eventType:claims.eventType}});
    if(error){await admin.from("zaincash_webhook_events").delete().eq("event_id",eventId);return json({error:"payment_finalization_failed"},500);}
  }else if(["FAILED","EXPIRED","REFUNDED"].includes(inquiry.status)){
    await admin.from("payment_transactions").update({status:inquiry.status==="EXPIRED"?"expired":inquiry.status==="REFUNDED"?"refunded":"failed",gateway_status:inquiry.status,gateway_transaction_id:transactionId,updated_at:new Date().toISOString()}).eq("id",payment.id).eq("status","pending");
  }else{
    await admin.from("payment_transactions").update({gateway_status:inquiry.status,gateway_transaction_id:transactionId,updated_at:new Date().toISOString()}).eq("id",payment.id);
  }
  return json({ok:true});
 }catch(error){return json({error:"webhook_rejected"},401);}
});
