"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Agent = { id:number; full_name:string; phone:string; city:string; vehicle_type?:string; vehicle_number?:string; is_online:boolean; is_verified:boolean };
type Stop = { shop_name?:string; shop_address?:string; address?:string; phone?:string };
type Delivery = { id:number; code:string; pickup_stops:Stop[]; pickup_progress:number; pickup_address:string; customer_name:string; customer_phone:string; delivery_address:string; delivery_city:string; delivery_instructions:string; item_summary:string; total_amount:number; payment_method:string; payment_status:string; status:string; proof_note?:string };
const API = (process.env.NEXT_PUBLIC_VEGZ_AGENT_API_URL || "http://localhost:8001").replace(/\/$/, "");
async function request<T>(path:string, token:string, init:RequestInit={}):Promise<T>{
 const response=await fetch(API+path,{...init,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{}),...(init.headers||{})}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(String((data as {detail?:string}).detail||"Request failed ("+response.status+")"));
 return data as T;
}
export default function AgentHomePage(){
 const [token,setToken]=useState("");
 const [agent,setAgent]=useState<Agent|null>(null);
 const [orders,setOrders]=useState<Delivery[]>([]);
 const [phone,setPhone]=useState("");
 const [code,setCode]=useState("123456");
 const [name,setName]=useState("Delivery Partner");
 const [city,setCity]=useState("Hubli");
 const [note,setNote]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [history,setHistory]=useState(false);
 const load=useCallback(async(session:string)=>{
   const [profile,list]=await Promise.all([request<Agent>("/api/me",session),request<Delivery[]>("/api/orders",session)]);
   setAgent(profile);setOrders(list);
 },[]);
 useEffect(()=>{
   const saved=window.localStorage.getItem("vegz-agent-token");
   if(saved){setToken(saved);void load(saved).catch(()=>{window.localStorage.removeItem("vegz-agent-token");setToken("");});}
 },[load]);
 async function login(event:FormEvent<HTMLFormElement>){
   event.preventDefault();setBusy(true);setError("");
   try{
     const result=await request<{access_token:string;agent:Agent}>("/api/auth/demo-login","",{method:"POST",body:JSON.stringify({phone,code,full_name:name,city})});
     window.localStorage.setItem("vegz-agent-token",result.access_token);setToken(result.access_token);await load(result.access_token);
     setNotice("Delivery workspace ready.");
   }catch(e){setError(e instanceof Error?e.message:"Sign-in failed.");}
   finally{setBusy(false);}
 }
 async function refresh(){
   if(!token)return;setBusy(true);setError("");
   try{await load(token);setNotice("Delivery list refreshed.");}
   catch(e){setError(e instanceof Error?e.message:"Refresh failed.");}
   finally{setBusy(false);}
 }
 async function availability(){
   if(!token||!agent)return;
   setError("");setNotice("");
   if(!agent.is_verified){
     setError("Your account is awaiting admin verification. You can go online and receive delivery assignments after approval.");
     return;
   }
   setBusy(true);
   try{
     await request<Agent>("/api/me",token,{method:"PATCH",body:JSON.stringify({is_online:!agent.is_online})});
     await load(token);
     setNotice(!agent.is_online ? "You are online and eligible for delivery assignments." : "You are offline and will not receive new assignments.");
   } catch(e){setError(e instanceof Error?e.message:"Could not update availability.");}
   finally{setBusy(false);}
 }
 async function seed(){
   if(!token)return;setBusy(true);setError("");
   try{const result=await request<{message?:string}>("/api/dev/seed",token,{method:"POST",body:"{}"});await load(token);setNotice(result.message||"Demo deliveries loaded.");}
   catch(e){setError(e instanceof Error?e.message:"Could not load demo deliveries.");}
   finally{setBusy(false);}
 }
 async function act(order:Delivery,action:string){
   if(!token)return;
   const needsNote=["decline","cancel_assignment","delivery_failed","delivered"].includes(action);
   if(needsNote&&!note.trim()){setError(action==="delivered"?"Add a delivery confirmation note first.":"Add a short reason before this action.");return;}
   setBusy(true);setError("");setNotice("");
   try{
     await request("/api/orders/"+order.id+"/action",token,{method:"PATCH",body:JSON.stringify({action,reason:note.trim(),proof_note:note.trim()})});
     setNote("");await load(token);setNotice("Delivery updated.");
   }catch(e){setError(e instanceof Error?e.message:"Could not update delivery.");}
   finally{setBusy(false);}
 }
 function signOut(){window.localStorage.removeItem("vegz-agent-token");setToken("");setAgent(null);setOrders([]);}
 const actions:Record<string,{label:string;action:string}[]> = {
   assigned:[{label:"Accept delivery",action:"accept"},{label:"Decline",action:"decline"}],
   accepted:[{label:"Arrived at pickup",action:"arrived_at_pickup"},{label:"Return assignment",action:"cancel_assignment"}],
   arrived_at_pickup:[{label:"Picked up stops",action:"picked_up"},{label:"Return assignment",action:"cancel_assignment"}],
   picked_up:[{label:"Arrived at customer",action:"arrived_at_customer"},{label:"Delivery failed",action:"delivery_failed"}],
   arrived_at_customer:[{label:"Confirm delivered",action:"delivered"},{label:"Delivery failed",action:"delivery_failed"}]
 };
 if(!token||!agent){
   return <main className="agent-desk"><header className="agent-topbar"><a className="agent-brand" href="#"><span>V</span> vegz<span>.</span></a><small>DELIVERY PARTNER</small></header>
    <section className="agent-login-layout"><div className="agent-welcome"><p className="agent-eyebrow">EVERY STOP COUNTS</p><h1>Deliver with care.<br/><span>Keep orders moving.</span></h1><p>Accept delivery assignments, collect from multiple shops, and record the customer handoff from one workspace.</p><div className="agent-art">🛵 <span>🥬</span><span>📦</span></div><p className="agent-muted">Live GPS is not enabled in this development build.</p></div>
     <form className="agent-login" onSubmit={login}><div className="agent-logo">V</div><h2>Agent sign in</h2><p>Use the configured development code. Approved agents can go online.</p><label>Full name</label><input required value={name} onChange={e=>setName(e.target.value)}/><label>Mobile number</label><input required value={phone} onChange={e=>setPhone(e.target.value)} inputMode="tel" placeholder="+91 mobile number"/><label>City</label><div className="agent-choices">{["Hubli","Dharwad"].map(c=><button type="button" key={c} className={city===c?"active":""} onClick={()=>setCity(c)}>{c}</button>)}</div><label>Development access code</label><input required value={code} onChange={e=>setCode(e.target.value)} inputMode="numeric"/><button className="agent-primary" disabled={busy}>{busy?"Signing in…":"Open delivery workspace →"}</button>{error&&<p className="agent-error">{error}</p>}<small>Production launch requires verified identity and security controls.</small></form>
    </section><footer className="agent-footer">VEGZ DELIVERY · SAFE RIDES, FRESH ORDERS</footer></main>;
 }
 const visible=orders.filter(o=>history?["delivered","delivery_failed","cancelled"].includes(o.status):!["delivered","delivery_failed","cancelled"].includes(o.status));
 return <main className="agent-desk"><header className="agent-topbar"><a className="agent-brand" href="#"><span>V</span> vegz<span>.</span></a><div className="agent-top-right"><span>{agent.city} · {agent.full_name}</span><button className="agent-secondary" onClick={refresh} disabled={busy}>↻ Refresh</button><button className="agent-link" onClick={signOut}>Sign out</button></div></header>
   <div className="agent-layout"><aside className="agent-sidebar"><div className="agent-profile"><span>🛵</span><div><strong>{agent.full_name}</strong><small>{agent.city} delivery partner</small></div></div><button className={!history?"active":""} onClick={()=>setHistory(false)}>▣ Active deliveries</button><button className={history?"active":""} onClick={()=>setHistory(true)}>☷ Delivery history</button><div className="agent-sidebar-note"><strong>Pickup checklist</strong><p>Confirm each shop stop before handing the order to the customer.</p></div></aside>
    <section className="agent-workspace"><div className="agent-heading"><div><p className="agent-eyebrow">VEGZ AGENT / {history?"HISTORY":"WORKSPACE"}</p><h1>{history?"Delivery history":"Ride safe. Deliver fresh."}</h1><p>{history?"Completed and failed deliveries from your account.":"Your assignments, pickup sequence and delivery status."}</p></div><span className={"agent-state "+(agent.is_online?"online":"offline")}>{agent.is_online?"● Online":"● Offline"}</span></div>
     {error&&<div className="agent-alert error">{error}</div>}{notice&&<div className="agent-alert success">{notice}</div>}
     <div className="agent-summary"><article><small>Visible deliveries</small><strong>{visible.length}</strong></article><article><small>Availability</small><strong>{agent.is_online?"Online":"Offline"}</strong></article><article><small>Approval</small><strong>{agent.is_verified?"Verified":"Pending"}</strong></article><div><p>{agent.is_verified?"You are cleared to receive work.":"Your account needs admin approval before going online."}</p><button className={agent.is_online?"agent-secondary":"agent-primary"} onClick={availability} disabled={busy}>{busy?"Updating…":!agent.is_verified?"Awaiting approval":agent.is_online?"Go offline":"Go online"}</button></div></div>
     {!history&&visible.length===0&&<div className="agent-empty"><span>✓</span><h2>No active deliveries</h2><p>Dispatch assignments appear here. For local development only, load sample jobs.</p><button className="agent-primary" onClick={seed} disabled={busy}>Load demo deliveries</button></div>}
     <div className="agent-deliveries">{visible.map(order=><article key={order.id} className="agent-delivery-card"><div className="agent-delivery-head"><div><small>DELIVERY CODE</small><h2>{order.code}</h2></div><span className="agent-order-status">{order.status.replaceAll("_"," ")}</span></div><div className="agent-customer"><div><small>CUSTOMER</small><strong>{order.customer_name}</strong><p>{order.customer_phone}</p></div><div><small>DELIVERY TO</small><strong>{order.delivery_city}</strong><p>{order.delivery_address}</p></div></div>{order.delivery_instructions&&<p className="agent-instructions">Delivery note: {order.delivery_instructions}</p>}<div className="agent-route"><h3>Pickup sequence</h3>{(order.pickup_stops&&order.pickup_stops.length?order.pickup_stops:[{shop_name:"Pickup shop",shop_address:order.pickup_address}]).map((stop,i)=><div key={i} className="agent-stop"><span className={i<order.pickup_progress?"done":i===order.pickup_progress?"current":""}>{i<order.pickup_progress?"✓":i+1}</span><div><strong>{stop.shop_name||"Shop pickup"}</strong><p>{stop.shop_address||stop.address||order.pickup_address}</p></div>{i<order.pickup_progress&&<small>Picked up</small>}</div>)}</div><div className="agent-items"><small>ORDER ITEMS</small><p>{order.item_summary||"Order details"}</p><strong>₹{Number(order.total_amount||0).toFixed(2)}</strong></div>{!history&&(actions[order.status]||[]).length>0&&<><label className="agent-note-label">Handoff note / reason (required for selected actions)</label><input className="agent-note-input" value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. Received by customer or reason for failure"/><div className="agent-actions">{(actions[order.status]||[]).map(a=><button key={a.action} className={["decline","delivery_failed","cancel_assignment"].includes(a.action)?"agent-secondary":"agent-primary"} onClick={()=>void act(order,a.action)} disabled={busy}>{a.label}</button>)}</div></>}</article>)}</div>
     <p className="agent-disclaimer">Live GPS tracking, push notifications and photo/OTP proof of delivery are not configured in this development build.</p>
    </section>
   </div><footer className="agent-footer">VEGZ DELIVERY · SAFE RIDES, FRESH ORDERS</footer></main>;
}
