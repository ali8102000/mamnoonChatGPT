import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const b64url=(s:string)=>s.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(s.length/4)*4,"=");
function decodePart(s:string){return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64url(s)),c=>c.charCodeAt(0))));}
async function verifyHs256(token:string,secret:string){
 const parts=token.split("."); if(parts.length!==3) throw new Error("invalid_jwt");
 const header=decodePart(parts[0]); if(header.alg!=="HS256") throw new Error("invalid_jwt_alg");
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
 const signature=Uint8Array.from(atob(b64url(parts[2])),c=>c.charCodeAt(0));
 if(!await crypto.subtle.verify("HMAC",key,signature,new TextEncoder().encode(parts[0]+"."+parts[1]))) throw new Error("invalid_jwt_signature");
 const payload=decodePart(parts[1]); const now=Math.floor(Date.now()/1000);
 if(payload.exp&&now>=payload.exp) throw new Error("expired_jwt");
 if(payload.nbf&&now<payload.nbf) throw new Error("premature_jwt");
 return payload;
}
async function getToken(base:string,id:string,secret:string){
 const body=new URLSearchParams({grant_type:"client_credentials",client_id:id,client_secret:secret,scope:"payment:read payment:write"});
 const res=await fetch(base+"/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
 const data=await res.json().catch(()=>({})); if(!res.ok||!data.access_token) throw new Error("oauth_failed"); return data.access_token as string;
}
Deno.serve(async(req:Request)=>{
 if(req.method!=="GET") return new Response("Method not allowed",{status:405});
 const fallback=Deno.env.get("MAMNOON_PAYMENT_RETURN_URL")||"https://existing-project-onrampadminbootstrap.lovable.app/subscriptions";
 try{
  const u=new URL(req.url); const signedToken=u.searchParams.get("token"); let finalStatus="pending";
  if(!signedToken) throw new Error("missing_token");
  const apiKey=Deno.env.get("ZAINCASH_API_KEY"); const clientId=Deno.env.get("ZAINCASH_CLIENT_ID"); const clientSecret=Deno.env.get("ZAINCASH_CLIENT_SECRET");
  const url=Deno.env.get("SUPABASE_URL"); const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const base=(Deno.env.get("ZAINCASH_BASE_URL")||"https://pg-api-uat.zaincash.iq").replace(/\/$/,"");
  if(!apiKey||!clientId||!clientSecret||!url||!serviceKey) throw new Error("configuration_incomplete");
  const claims=await verifyHs256(signedToken,apiKey);
  const data=claims.data||{}; const transactionId=data.transactionId; const reference=data.merchantReferenceId;
  if(typeof transactionId!=="string"||typeof reference!=="string") throw new Error("invalid_callback_claims");
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:payment,error}=await admin.from("payment_transactions").select("id,amount,currency,external_reference_id,status,gateway_transaction_id").eq("external_reference_id",reference).maybeSingle();
  if(error||!payment) throw new Error("payment_not_found");
  if(payment.status==="paid") finalStatus="success";
  if(payment.status!=="paid"){
   const token=await getToken(base,clientId,clientSecret);
   const res=await fetch(base+"/api/v2/payment-gateway/transaction/inquiry/"+encodeURIComponent(transactionId),{headers:{Authorization:"Bearer "+token}});
   const inquiry=await res.json().catch(()=>({})); if(!res.ok) throw new Error("inquiry_failed");
   const details=inquiry.transactionDetails||{};
   if(details.transactionId!==transactionId||details.externalReferenceId!==reference) throw new Error("inquiry_mismatch");
   const amount=Number(details.amount?.value); const currency=details.amount?.currency;
   if(amount!==payment.amount||currency!=="IQD") throw new Error("amount_mismatch");
   if(inquiry.status==="SUCCESS"){
    finalStatus="success";
    const {error:finalizeError}=await admin.rpc("finalize_zaincash_payment",{p_payment_id:payment.id,p_gateway_transaction_id:transactionId,p_gateway_status:"SUCCESS",p_confirmed_amount:amount,p_currency:currency,p_payload:{source:"redirect_callback"}});
    if(finalizeError) throw new Error("finalization_failed");
   }else if(["FAILED","EXPIRED"].includes(inquiry.status)){
    finalStatus="failure";
    await admin.from("payment_transactions").update({status:inquiry.status==="EXPIRED"?"expired":"failed",gateway_status:inquiry.status,gateway_transaction_id:transactionId,updated_at:new Date().toISOString()}).eq("id",payment.id).eq("status","pending");
   }else{
    await admin.from("payment_transactions").update({gateway_status:inquiry.status,gateway_transaction_id:transactionId,updated_at:new Date().toISOString()}).eq("id",payment.id);
   }
  }
  const finalUrl=new URL(fallback); finalUrl.searchParams.set("payment",finalStatus); finalUrl.searchParams.set("ref",reference);
  return Response.redirect(finalUrl.toString(),303);
 }catch(_error){
  const finalUrl=new URL(fallback); finalUrl.searchParams.set("payment","pending");
  return Response.redirect(finalUrl.toString(),303);
 }
});
