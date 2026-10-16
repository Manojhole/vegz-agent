const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = { token: localStorage.getItem("vegzAgentToken") || "", agent: null, orders: [], view: "overview", action: null };
const money = value => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(Number(value||0));
const esc = value => String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let toastTimer;
function toast(message,error=false){const el=$("#toast");el.textContent=message;el.className="toast show"+(error?" error":"");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className="toast",3000)}
async function api(path,options={}){
 const headers={"Content-Type":"application/json",...(options.headers||{})};if(state.token)headers.Authorization="Bearer "+state.token;
 let response;try{response=await fetch(path,{...options,headers})}catch{throw new Error("Cannot reach the Vegz Agent API. Check that the server is running.")}
 const data=await response.json().catch(()=>({}));if(!response.ok){if(response.status===401&&state.token)signOut(false);throw new Error(data.detail||"Request failed. Please try again.")}return data;
}
function setBusy(button,busy,label="Saving…"){if(!button)return;if(busy){button.dataset.original=button.textContent;button.disabled=true;button.textContent=label}else{button.disabled=false;button.textContent=button.dataset.original||"Save"}}
async function signIn(phone,code,name,city){
 const result=await api("/api/auth/demo-login",{method:"POST",body:JSON.stringify({phone,code,full_name:name,city})});
 state.token=result.access_token;localStorage.setItem("vegzAgentToken",state.token);state.agent=result.agent;
 $("#login-screen").classList.add("hidden");$("#app-shell").classList.remove("hidden");await refreshAll();showView("overview");
}
function signOut(show=true){state.token="";state.agent=null;localStorage.removeItem("vegzAgentToken");$("#app-shell").classList.add("hidden");$("#login-screen").classList.remove("hidden");if(show)toast("You have signed out.")}
async function refreshAll(){const [agent,orders]=await Promise.all([api("/api/me"),api("/api/orders")]);state.agent=agent;state.orders=orders;renderAll()}
function activeOrders(){return state.orders.filter(o=>!["delivered","declined","cancelled","delivery_failed"].includes(o.status))}
function completedOrders(){return state.orders.filter(o=>["delivered","declined","cancelled"].includes(o.status))}
function renderAll(){
 if(!state.agent)return;const a=state.agent,orders=state.orders,active=activeOrders(),done=orders.filter(o=>o.status==="delivered"&&o.delivered_at&&o.delivered_at.slice(0,10)===new Date().toISOString().slice(0,10));
 $("#sidebar-agent-name").textContent=a.full_name;$("#top-agent-name").textContent=a.full_name;$("#profile-name").value=a.full_name;$("#profile-phone").value=a.phone;$("#vehicle-type").value=a.vehicle_type||"Bike";$("#vehicle-number").value=a.vehicle_number||"";$("#profile-city").value=a.city||"Hubli";
 $("#online-toggle").checked=a.is_online;$("#profile-online-toggle").checked=a.is_online;$("#online-label").textContent=a.is_online?"You're online":"You're offline";$("#sidebar-online-dot").classList.toggle("active",a.is_online);
 const approved = Boolean(a.is_verified);
 $("#approval-notice").classList.toggle("hidden", approved);
 $("#online-toggle").disabled = !approved; $("#profile-online-toggle").disabled = !approved;
 $("#stat-active").textContent=active.length;$("#stat-delivered").textContent=done.length;$("#stat-fees").textContent=money(done.reduce((s,o)=>s+Number(o.delivery_fee||0),0));$("#stat-online").textContent=a.is_online?"Online":"Offline";$("#stat-online-foot").textContent=a.is_online?"You're available for assignments":"Switch online when you're ready";$("#nav-active-count").textContent=active.length;$("#verified-pill").textContent=a.is_verified?"Verified":"Pending";$("#profile-status-note").textContent=a.is_online?"You are online. Your dispatch team can assign new deliveries.":"You are offline. You may not receive new assignments.";
 const upcoming=active.slice(0,3);$("#overview-orders").innerHTML=upcoming.map(o=>renderOrder(o,true)).join("")||emptyInline("You're all caught up","New assigned deliveries will appear here.");renderDeliveries();renderHistory();
}
function statusLabel(status){return status.replaceAll("_"," ")}
function statusPill(status){return `<span class="status-pill status-${esc(status)}">${esc(statusLabel(status))}</span>`}
function emptyInline(title,desc){return `<div class="empty-state"><div>🛵</div><h3>${esc(title)}</h3><p>${esc(desc)}</p></div>`}
function orderActions(order,compact=false){
 const definitions={
 assigned:[["accept","Accept delivery","primary"],["decline","Decline","danger"]],
 accepted:[["arrived_at_pickup","Arrived at shop","primary"],["cancel_assignment","Return assignment","danger"]],
 arrived_at_pickup:[["picked_up","Confirm pickup","primary"]],
 picked_up:[["arrived_at_customer","Arrived at customer","primary"],["delivery_failed","Report delivery failure","danger"]],
 arrived_at_customer:[["delivered","Complete delivery","primary"],["delivery_failed","Report delivery failure","danger"]],
 delivered:[],delivery_failed:[],declined:[],cancelled:[]
 };
 return (definitions[order.status]||[]).map(([action,label,kind])=>`<button class="btn ${kind==="danger"?"danger":"primary"} ${compact?"small":""}" data-action="${action}" data-order-id="${order.id}">${label}</button>`).join("");
}
function renderOrder(order,compact=false){
 const isCash=String(order.payment_method).toLowerCase()==="cash"||String(order.payment_method).toLowerCase()==="cod";
 return `<article class="delivery-card">
 <div class="delivery-head"><div class="delivery-code"><div class="package-icon">📦</div><div><strong>${esc(order.code)} · ${esc(order.shop_name)}</strong><small>${new Date(order.assigned_at).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"})}</small></div></div>${statusPill(order.status)}</div>
 <div class="delivery-content">
 ${(order.pickup_stops && order.pickup_stops.length ? order.pickup_stops : [{shop_name:order.shop_name,shop_phone:order.shop_phone,pickup_address:order.pickup_address,item_summary:order.item_summary}]).map((stop,index)=>'<div class="route-point"><div class="route-symbol">'+(index+1)+'</div><div><strong>'+(index < Number(order.pickup_progress||0) ? '✓ Picked up · ' : index === Number(order.pickup_progress||0) ? 'Next pickup · ' : 'Upcoming pickup · ') + esc(stop.shop_name)+'</strong><p>'+esc(stop.pickup_address||"Pickup address will be shared")+'</p><small>'+esc(stop.shop_phone||"Shop phone unavailable")+'</small>'+(stop.item_summary?'<small>Items: '+esc(stop.item_summary)+'</small>':'')+'</div></div>').join("")}
 <div class="route-point"><div class="route-symbol">⌖</div><div><strong>Deliver to customer</strong><p>${esc(order.delivery_address||"Customer address will be shared")}</p><small>${esc(order.customer_name)} · ${esc(order.customer_phone||"Phone unavailable")}</small>${order.delivery_instructions?`<small>Note: ${esc(order.delivery_instructions)}</small>`:""}</div></div>
 </div>
 <div class="order-details"><span class="detail-chip">🧺 <strong>${esc(order.item_summary||"Items as per order")}</strong></span><span class="detail-chip">Order total <strong>${money(order.total_amount)}</strong></span><span class="detail-chip">Pay type <strong>${isCash?"Cash / COD":esc(order.payment_method)}</strong></span><span class="detail-chip">Delivery fee <strong>${money(order.delivery_fee)}</strong></span></div>
 <div class="delivery-actions">${orderActions(order,compact)||'<span class="muted">No action required for this status.</span>'}<span class="action-spacer"></span>${compact?'<button class="btn secondary small" data-open-order="'+order.id+'">Details ↗</button>':""}</div>
 </article>`;
}
function renderDeliveries(){
 const filter=$("#delivery-filter").value,search=$("#delivery-search").value.trim().toLowerCase();
 const rows=state.orders.filter(o=>filter==="active"? !["delivered","declined","cancelled"].includes(o.status):filter==="all"?true:o.status===filter)
  .filter(o=>[o.code,o.shop_name,o.customer_name,o.pickup_address,o.delivery_address,o.status].some(v=>String(v||"").toLowerCase().includes(search)));
 $("#delivery-list").innerHTML=rows.map(o=>renderOrder(o,false)).join("");$("#delivery-list").classList.toggle("hidden",rows.length===0);$("#deliveries-empty").classList.toggle("hidden",rows.length!==0);
}
function renderHistory(){
 const rows=completedOrders().sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
 $("#history-summary").textContent=`${rows.filter(o=>o.status==="delivered").length} delivered · ${rows.filter(o=>o.status==="declined").length} declined · ${rows.filter(o=>o.status==="cancelled").length} returned/cancelled`;
 $("#history-list").innerHTML=rows.map(o=>renderOrder(o,true)).join("");$("#history-empty").classList.toggle("hidden",rows.length>0);$("#history-list").classList.toggle("hidden",rows.length===0);
}
function showView(view){
 state.view=view;$$(".view").forEach(el=>el.classList.add("hidden"));$("#view-"+view).classList.remove("hidden");$$(".nav-item").forEach(el=>el.classList.toggle("active",el.dataset.view===view));
 const names={overview:"Overview",deliveries:"My deliveries",history:"Delivery history",profile:"My profile"};
 $("#breadcrumb-title").textContent=names[view];$("#page-title").textContent=({overview:"Ready to deliver? 👋",deliveries:"Your delivery queue 📦",history:"Delivery history ◷",profile:"Your partner profile ⚙"})[view];
 $("#page-subtitle").textContent=({overview:"Here's your delivery activity today.",deliveries:"Follow each assigned order through pickup and drop-off.",history:"Review completed and returned assignments.",profile:"Keep your details current and manage availability."})[view];
 if(view==="deliveries")renderDeliveries();if(view==="history")renderHistory();window.scrollTo({top:0,behavior:"smooth"});
}
const actionMeta={
 accept:{title:"Accept delivery",description:"Confirm that you can complete this assigned delivery.",label:"Optional note",placeholder:"Anything the dispatch team should know?",required:false},
 decline:{title:"Decline assignment",description:"The dispatch team will need to reassign this delivery. Please provide a reason.",label:"Reason for declining *",placeholder:"e.g. Outside service area, vehicle issue",required:true},
 arrived_at_pickup:{title:"Arrived at shop",description:"Confirm you have reached the pickup location.",label:"Pickup note (optional)",placeholder:"Shop contact or pickup instructions",required:false},
 picked_up:{title:"Confirm order pickup",description:"Check the items and order code with the shop before confirming pickup.",label:"Pickup confirmation note (optional)",placeholder:"e.g. Items checked, package sealed",required:false},
 arrived_at_customer:{title:"Arrived at customer",description:"Confirm you have reached the delivery address.",label:"Arrival note (optional)",placeholder:"e.g. Called customer on arrival",required:false},
 delivered:{title:"Complete delivery",description:"Add a confirmation note before closing this delivery.",label:"Delivery confirmation *",placeholder:"e.g. Handed to customer at front door",required:true},
 delivery_failed:{title:"Report delivery failure",description:"Explain what prevented delivery. Dispatch can review and reassign the order.",label:"Failure reason *",placeholder:"e.g. Customer unavailable after calling",required:true},
 cancel_assignment:{title:"Return assignment",description:"Explain why this assignment must be returned to dispatch.",label:"Reason for return *",placeholder:"e.g. Vehicle breakdown, safety issue",required:true}
};
function openAction(orderId,action){
 const order=state.orders.find(o=>o.id===Number(orderId));if(!order)return;
 const meta=actionMeta[action];if(!meta)return;
 state.action={orderId:Number(orderId),action};
 $("#action-order-id").value=orderId;$("#action-name").value=action;$("#action-title").textContent=meta.title;$("#action-description").textContent=meta.description;$("#action-note-label").textContent=meta.label;$("#action-note").placeholder=meta.placeholder;$("#action-note").value="";$("#action-note").required=meta.required;
 $("#action-dialog").showModal();
}
async function submitAction(orderId,action,note,button){
 const reason=["decline","cancel_assignment","delivery_failed"].includes(action)?note:"";
 const proof_note=action==="delivered"?note:"";
 await withButton(button,async()=>{await api(`/api/orders/${orderId}/action`,{method:"PATCH",body:JSON.stringify({action,reason,proof_note})});$("#action-dialog").close();await refreshAll();toast(({accept:"Delivery accepted.",decline:"Assignment declined and removed from your queue.",arrived_at_pickup:"Pickup arrival recorded.",picked_up:"Pickup confirmed. Ride safely.",arrived_at_customer:"Customer arrival recorded.",delivered:"Delivery marked complete.",cancel_assignment:"Assignment returned to dispatch."})[action]||"Delivery updated.");});
}
async function withButton(button,task){setBusy(button,true,"Please wait…");try{await task()}catch(e){toast(e.message||"Something went wrong.",true)}finally{setBusy(button,false)}}
async function setOnline(value,input){
 input.disabled=true;try{state.agent=await api("/api/me",{method:"PATCH",body:JSON.stringify({is_online:value})});renderAll();toast(value?"You're online and available.":"You're now offline.");}
 catch(e){input.checked=!value;toast(e.message,true)}finally{input.disabled=false}
}
$("#login-form").addEventListener("submit",async e=>{e.preventDefault();const btn=e.submitter;setBusy(btn,true,"Signing in…");try{await signIn($("#agent-phone").value.trim(),$("#agent-code").value.trim(),$("#agent-name").value.trim(),$("#agent-city").value);toast("Welcome to Vegz Agent.")}catch(err){toast(err.message,true)}finally{setBusy(btn,false)}});
$("#logout-btn").addEventListener("click",()=>signOut());
$("#refresh-btn").addEventListener("click",async()=>{try{await refreshAll();toast("Delivery data refreshed.")}catch(e){toast(e.message,true)}});
$("#nav").addEventListener("click",e=>{const button=e.target.closest("[data-view]");if(button)showView(button.dataset.view)});
document.body.addEventListener("click",async e=>{
 const go=e.target.closest("[data-goto]");if(go)return showView(go.dataset.goto);
 const action=e.target.closest("[data-action]");if(action)return openAction(action.dataset.orderId,action.dataset.action);
 const detail=e.target.closest("[data-open-order]");if(detail){showView("deliveries");$("#delivery-filter").value="all";$("#delivery-search").value=detail.dataset.openOrder;renderDeliveries();}
});
$("#online-toggle").addEventListener("change",e=>setOnline(e.target.checked,e.target));
$("#profile-online-toggle").addEventListener("change",e=>{const desired=e.target.checked;$("#online-toggle").checked=desired;setOnline(desired,e.target)});
$("#profile-form").addEventListener("submit",e=>{e.preventDefault();const payload={full_name:$("#profile-name").value.trim(),vehicle_type:$("#vehicle-type").value,vehicle_number:$("#vehicle-number").value.trim(),city:$("#profile-city").value};withButton(e.submitter,async()=>{state.agent=await api("/api/me",{method:"PATCH",body:JSON.stringify(payload)});renderAll();toast("Partner profile saved.")})});
$("#delivery-search").addEventListener("input",renderDeliveries);$("#delivery-filter").addEventListener("change",renderDeliveries);
$("#seed-btn").addEventListener("click",async()=>{await withButton($("#seed-btn"),async()=>{const result=await api("/api/dev/seed",{method:"POST"});await refreshAll();$("#delivery-filter").value="active";renderDeliveries();toast(result.message)})});
$("#close-action-dialog").addEventListener("click",()=>$("#action-dialog").close());$("#cancel-action").addEventListener("click",()=>$("#action-dialog").close());
$("#action-form").addEventListener("submit",async e=>{e.preventDefault();if(!state.action)return;const meta=actionMeta[state.action.action],note=$("#action-note").value.trim();if(meta.required&&!note)return toast("Please fill in the required note.",true);await submitAction(state.action.orderId,state.action.action,note,e.submitter)});
(async function boot(){if(!state.token)return;$("#login-screen").classList.add("hidden");$("#app-shell").classList.remove("hidden");try{await refreshAll();showView("overview")}catch(e){signOut(false);toast(e.message||"Please sign in again.",true)}})();
