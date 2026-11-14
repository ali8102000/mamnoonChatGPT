import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), { status, headers: cors });
const required = (name: string) => { const v=Deno.env.get(name); if(!v) throw new Error("missing_"+name); return v; };

async function getGatewayToken(baseUrl: string, clientId: string, clientSecret: string) {
  const body = new URLSearchParams({ grant_type:"client_credentials", client_id:clientId, client_secret:clientSecret, scope:"payment:read payment:write" });
  const response = await fetch(baseUrl + "/oauth2/token", { method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" }, body });
  const data = await response.json().catch(()=>({}));
  if(!response.ok || !data.access_token) throw new Error("zaincash_oauth_failed");
  return data.access_token as string;
}

Deno.serve(async (req: Request) => {
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json({error:"method_not_allowed"},405);
  try {
    const enabled = Deno.env.get("ZAINCASH_ENABLED")==="true";
    if(!enabled) return json({error:"zaincash_not_enabled"},503);
    const supabaseUrl=required("SUPABASE_URL");
    const anonKey=required("SUPABASE_ANON_KEY");
    const serviceKey=required("SUPABASE_SERVICE_ROLE_KEY");
    const clientId=required("ZAINCASH_CLIENT_ID");
    const clientSecret=required("ZAINCASH_CLIENT_SECRET");
    const apiKey=required("ZAINCASH_API_KEY");
    const baseUrl=(Deno.env.get("ZAINCASH_BASE_URL") || "https://pg-api-uat.zaincash.iq").replace(/\/$/,"");
    const returnUrl=required("MAMNOON_PAYMENT_RETURN_URL");
    if(!returnUrl.startsWith("https://")) return json({error:"https_urls_required"},503);
    const callbackBase=supabaseUrl.replace(/\/$/,"")+"/functions/v1/zaincash-callback";
    const authHeader=req.headers.get("Authorization") || "";
    const bearer=authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if(!bearer) return json({error:"unauthorized"},401);
    const userClient=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:"Bearer "+bearer}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error:userError}=await userClient.auth.getUser(bearer);
    if(userError || !user) return json({error:"unauthorized"},401);
    const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const body=await req.json().catch(()=>null);
    if(!body || !["subscription","service_request"].includes(body.purpose)) return json({error:"invalid_request"},400);
    let amount:number, planId:string|null=null, requestId:string|null=null;
    if(body.purpose==="subscription") {
      if(typeof body.planId!=="string") return json({error:"plan_required"},400);
      const {data:settings}=await admin.from("subscription_settings").select("payment_gateway_enabled,subscription_enabled").eq("id",1).maybeSingle();
      if(!settings?.payment_gateway_enabled || !settings?.subscription_enabled) return json({error:"payments_temporarily_disabled"},503);
      const {data:plan,error}=await admin.from("subscription_plans").select("id,code,monthly_price,currency,is_active").eq("id",body.planId).maybeSingle();
      if(error || !plan || !plan.is_active || plan.currency!=="IQD" || plan.monthly_price<=0 || ["free","trial"].includes(plan.code)) return json({error:"plan_not_payable"},400);
      const {data:sub}=await admin.from("user_subscriptions").select("grant_type").eq("user_id",user.id).maybeSingle();
      if(sub?.grant_type==="admin") return json({error:"company_granted_subscription_locked"},403);
      amount=plan.monthly_price; planId=plan.id;
    } else {
      if(typeof body.requestId!=="string") return json({error:"request_required"},400);
      const {data:request,error}=await admin.from("service_requests").select("id,customer_id,status,customer_payable,customer_price,price_estimate,payment_method").eq("id",body.requestId).maybeSingle();
      if(error || !request || request.customer_id!==user.id) return json({error:"request_not_found"},404);
      if(!["accepted","in_progress","completed"].includes(request.status)) return json({error:"request_not_ready_for_payment"},409);
      if(request.payment_method==="zaincash") return json({error:"request_already_paid"},409);
      const raw=request.customer_payable ?? request.customer_price ?? request.price_estimate;
      amount=Number(raw);
      if(!Number.isSafeInteger(amount) || amount<=0) return json({error:"request_price_not_final"},409);
      requestId=request.id;
    }
    const {data:payment,error:insertError}=await admin.from("payment_transactions").insert({
      user_id:user.id,purpose:body.purpose,plan_id:planId,request_id:requestId,amount,currency:"IQD",provider:"zaincash",status:"pending"
    }).select("id,external_reference_id").single();
    if(insertError || !payment) return json({error:"payment_record_failed"},500);
    try {
      const token=await getGatewayToken(baseUrl,clientId,clientSecret);
      const success=callbackBase+"?return=success";
      const failure=callbackBase+"?return=failure";
      const initResponse=await fetch(baseUrl+"/api/v2/payment-gateway/transaction/init",{
        method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
        body:JSON.stringify({
          language:"Ar",externalReferenceId:payment.external_reference_id,orderId:payment.id,
          serviceType:body.purpose==="subscription"?"MamnoonSubscription":"MamnoonService",
          amount:{value:String(amount),currency:"IQD"},
          redirectUrls:{successUrl:success,failureUrl:failure}
        })
      });
      const initData=await initResponse.json().catch(()=>({}));
      const details=initData.transactionDetails || {};
      const transactionId=details.transactionId;
      const redirectUrl=initData.redirectUrl;
      if(!initResponse.ok || initData.status!=="SUCCESS" || !transactionId || !redirectUrl) throw new Error("zaincash_init_failed");
      const {error:updateError}=await admin.from("payment_transactions").update({
        gateway_transaction_id:transactionId,redirect_url:redirectUrl,gateway_status:initData.status,
        expires_at:initData.expiryTime || null,metadata:{orderId:payment.id}
      }).eq("id",payment.id);
      if(updateError) throw new Error("payment_record_update_failed");
      return json({paymentId:payment.id,redirectUrl,status:"pending"});
    } catch(error) {
      await admin.from("payment_transactions").update({status:"failed",gateway_status:"INIT_FAILED",metadata:{error:String(error)}}).eq("id",payment.id);
      return json({error:"payment_initialization_failed"},502);
    }
  } catch(error) {
    const message=String(error);
    if(message.startsWith("Error: missing_")) return json({error:"payment_configuration_incomplete"},503);
    return json({error:"internal_error"},500);
  }
});
