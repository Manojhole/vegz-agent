import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as SecureStore from "expo-secure-store";

const API_BASE = (process.env.EXPO_PUBLIC_VEGZ_AGENT_API_URL || "http://10.0.2.2:8001").replace(/\/$/, "");

type Agent = { id: number; full_name: string; phone: string; city: string; vehicle_type: string; vehicle_number: string; is_online: boolean; is_verified: boolean };
type PickupStop = { shop_name?: string; shop_address?: string; address?: string; phone?: string };
type Delivery = { id: number; code: string; shop_name: string; pickup_stops: PickupStop[]; pickup_progress: number; pickup_address: string; customer_name: string; customer_phone: string; delivery_address: string; delivery_city: string; delivery_instructions: string; item_summary: string; total_amount: number; delivery_fee: number; payment_method: string; payment_status: string; status: string; proof_note: string };
type Json = Record<string, unknown>;

async function api<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(API_BASE + path, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
  const data = await response.json().catch(() => ({} as Json));
  if (!response.ok) throw new Error(String((data as Json).detail || `Request failed (${response.status})`));
  return data as T;
}

export default function AgentApp() {
  const [token, setToken] = useState("");
  const [agent, setAgent] = useState<Agent | null>(null);
  const [orders, setOrders] = useState<Delivery[]>([]);
  const [name, setName] = useState("Delivery Partner");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("123456");
  const [city, setCity] = useState("Hubli");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (session: string) => {
    const profile = await api<Agent>("/api/me", session);
    const dashboard = await api<{active_orders: Delivery[]}>("/api/dashboard", session);
    setAgent(profile);
    setOrders(dashboard.active_orders || []);
  }, []);

  useEffect(() => {
    SecureStore.getItemAsync("vegz-agent-token").then(async saved => {
      if (!saved) return;
      try { await load(saved); setToken(saved); } catch { await SecureStore.deleteItemAsync("vegz-agent-token"); }
    }).catch(() => undefined);
  }, [load]);

  async function signIn() {
    setBusy(true); setError("");
    try {
      const result = await api<{access_token:string;agent:Agent}>("/api/auth/demo-login", undefined, {
        method:"POST", body:JSON.stringify({phone,code,full_name:name,city}),
      });
      await SecureStore.setItemAsync("vegz-agent-token", result.access_token);
      setToken(result.access_token);
      await load(result.access_token);
    } catch(e) { setError(e instanceof Error?e.message:"Unable to sign in."); }
    finally { setBusy(false); }
  }

  async function refresh() {
    if (!token) return;
    setBusy(true); setError("");
    try { await load(token); } catch(e) { setError(e instanceof Error?e.message:"Refresh failed."); }
    finally { setBusy(false); }
  }

  async function toggleOnline() {
    if (!token || !agent) return;
    setBusy(true); setError("");
    try {
      await api<Agent>("/api/me",token,{method:"PATCH",body:JSON.stringify({is_online:!agent.is_online})});
      await load(token);
    } catch(e) { setError(e instanceof Error?e.message:"Could not update availability."); }
    finally { setBusy(false); }
  }

  async function seed() {
    if (!token) return;
    setBusy(true); setError("");
    try { await api("/api/dev/seed",token,{method:"POST",body:"{}"}); await load(token); }
    catch(e) { setError(e instanceof Error?e.message:"Could not load demo deliveries."); }
    finally { setBusy(false); }
  }

  async function act(order: Delivery, action: string) {
    if (!token) return;
    const needsNote = ["decline","cancel_assignment","delivery_failed","delivered"].includes(action);
    if (needsNote && !note.trim()) { setError(action==="delivered"?"Add a delivery confirmation note first.":"Enter a brief reason in the note field first."); return; }
    setBusy(true); setError("");
    try {
      await api(`/api/orders/${order.id}/action`,token,{method:"PATCH",body:JSON.stringify({action,reason:note.trim(),proof_note:note.trim()})});
      setNote("");
      await load(token);
    } catch(e) { setError(e instanceof Error?e.message:"Could not update delivery."); }
    finally { setBusy(false); }
  }

  async function signOut() {
    await SecureStore.deleteItemAsync("vegz-agent-token"); setToken(""); setAgent(null); setOrders([]);
  }

  if (!token || !agent) {
    return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page}>
      <Text style={s.brand}>vegz<Text style={s.period}>agent.</Text></Text><Text style={s.eyebrow}>DELIVERY PARTNER APP</Text>
      <Text style={s.title}>Every stop counts.</Text><Text style={s.sub}>Accept deliveries, manage shop pickups and keep customers informed.</Text>
      <View style={s.card}><Text style={s.label}>Your name</Text><TextInput style={s.input} value={name} onChangeText={setName} placeholder="Full name"/>
      <Text style={s.label}>Mobile number</Text><TextInput style={s.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+91 98765 43210"/>
      <Text style={s.label}>Registration city</Text><View style={s.choiceRow}>{["Hubli","Dharwad"].map(value=><Pressable key={value} onPress={()=>setCity(value)} style={[s.choice,city===value&&s.choiceActive]}><Text style={[s.choiceText,city===value&&s.choiceTextActive]}>{value}</Text></Pressable>)}</View>
      <Text style={s.label}>Development access code</Text><TextInput style={s.input} value={code} onChangeText={setCode} keyboardType="number-pad"/>
      <Action label={busy?"Signing in…":"Open delivery app"} onPress={signIn} disabled={busy||!phone.trim()||name.trim().length<2}/></View>
      <Text style={s.helper}>Development sign-in only. Real agents require verified OTP and admin approval before going online.</Text>
      {!!error&&<Text style={s.error}>{error}</Text>}{busy&&<ActivityIndicator color="#176b48"/>}
    </ScrollView></SafeAreaView>;
  }

  const nextActions: Record<string,{label:string;action:string}[]> = {
    assigned:[{label:"Accept delivery",action:"accept"},{label:"Decline",action:"decline"}],
    accepted:[{label:"Arrived at pickup",action:"arrived_at_pickup"},{label:"Return assignment",action:"cancel_assignment"}],
    arrived_at_pickup:[{label:"Picked up this stop",action:"picked_up"},{label:"Return assignment",action:"cancel_assignment"}],
    picked_up:[{label:"Arrived at customer",action:"arrived_at_customer"},{label:"Delivery failed",action:"delivery_failed"}],
    arrived_at_customer:[{label:"Confirm delivered",action:"delivered"},{label:"Delivery failed",action:"delivery_failed"}],
  };

  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page}>
    <View style={s.header}><View><Text style={s.brand}>vegz<Text style={s.period}>agent.</Text></Text><Text style={s.muted}>{agent.full_name} · {agent.city}</Text></View><Pressable onPress={signOut}><Text style={s.link}>Sign out</Text></Pressable></View>
    <View style={s.hero}><Text style={s.eyebrow}>DELIVERY WORKSPACE</Text><Text style={s.title}>Ride safe. Deliver fresh.</Text><Text style={s.sub}>Your assigned deliveries and pickup sequence.</Text>
      <View style={s.onlineRow}><View><Text style={s.onlineTitle}>{agent.is_online?"You are online":"You are offline"}</Text><Text style={s.muted}>{agent.is_verified?"Approved delivery partner":"Waiting for admin approval"}</Text></View><Action label={agent.is_online?"Go offline":"Go online"} onPress={toggleOnline} disabled={busy||!agent.is_verified} compact/></View>
    </View>
    {!!error&&<Text style={s.error}>{error}</Text>}
    <View style={s.metrics}><Metric value={String(orders.length)} label="Active deliveries"/><Metric value={String(orders.filter(o=>o.status==="delivered").length)} label="Delivered in view"/><Metric value={agent.is_online?"Online":"Offline"} label="Availability"/></View>
    <View style={s.sectionHead}><Text style={s.heading}>My deliveries</Text><Pressable onPress={refresh}><Text style={s.link}>↻ Refresh</Text></Pressable></View>
    {orders.length===0&&<View style={s.card}><Text style={s.customer}>No active deliveries</Text><Text style={s.helper}>Assigned orders appear here after dispatch. For local development only, load sample deliveries.</Text><Action label="Load demo deliveries" onPress={seed} disabled={busy}/></View>}
    {orders.map(order=><View key={order.id} style={s.orderCard}>
      <View style={s.orderHead}><Text style={s.orderCode}>{order.code}</Text><Text style={s.status}>{order.status.replace(/_/g," ")}</Text></View>
      <Text style={s.customer}>{order.customer_name}</Text><Text style={s.muted}>{order.delivery_address}, {order.delivery_city}</Text>
      {!!order.delivery_instructions&&<Text style={s.note}>{order.delivery_instructions}</Text>}
      <View style={s.detail}><Text style={s.label}>Items</Text><Text style={s.body}>{order.item_summary||"Order items"}</Text></View>
      <View style={s.detail}><Text style={s.label}>Pickups</Text>{(order.pickup_stops?.length?order.pickup_stops:[{shop_name:order.shop_name,shop_address:order.pickup_address}]).map((stop,index)=><Text key={index} style={s.body}>{index===order.pickup_progress?"📍 ":"• "}{stop.shop_name||order.shop_name} — {stop.shop_address||stop.address||order.pickup_address}{index<order.pickup_progress?" · picked up":""}</Text>)}</View>
      <View style={s.money}><Text style={s.muted}>{order.payment_method.toUpperCase()} · payment {order.payment_status}</Text><Text style={s.amount}>₹{Number(order.total_amount).toFixed(2)}</Text></View>
      {(nextActions[order.status]||[]).length>0&&<><TextInput style={s.input} value={note} onChangeText={setNote} placeholder="Delivery note or reason (when required)"/><View style={s.choiceRow}>{(nextActions[order.status]||[]).map(item=><Action key={item.action} label={item.label} onPress={()=>act(order,item.action)} disabled={busy} compact secondary={item.action==="decline"||item.action==="delivery_failed"||item.action==="cancel_assignment"}/>)}</View></>}
    </View>)}
    <Action label={busy?"Working…":"Refresh workspace"} onPress={refresh} disabled={busy}/>
    <Text style={s.helper}>Live GPS collection is not enabled in this build. Pickup, status and proof-note actions are sent to the agent API.</Text>
  </ScrollView></SafeAreaView>;
}

function Action({label,onPress,disabled=false,secondary=false,compact=false}:{label:string;onPress:()=>void;disabled?:boolean;secondary?:boolean;compact?:boolean}) { return <Pressable onPress={onPress} disabled={disabled} style={[s.action,secondary&&s.actionSecondary,compact&&s.actionCompact,disabled&&s.disabled]}><Text style={[s.actionText,secondary&&s.actionTextSecondary]}>{label}</Text></Pressable>; }
function Metric({label,value}:{label:string;value:string}) { return <View style={s.metric}><Text style={s.metricValue}>{value}</Text><Text style={s.muted}>{label}</Text></View>; }

const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:"#f6f8f1"},page:{padding:18,paddingTop:20,paddingBottom:40,gap:14},header:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},brand:{fontSize:28,fontWeight:"900",color:"#176b48",letterSpacing:-1},period:{color:"#ef8a36"},eyebrow:{color:"#176b48",fontSize:10,fontWeight:"900",letterSpacing:2,marginBottom:8},title:{fontSize:31,lineHeight:36,fontWeight:"900",color:"#1b3027"},sub:{fontSize:14,lineHeight:21,color:"#718077",marginTop:7},muted:{fontSize:12,color:"#718077",marginTop:4},card:{backgroundColor:"#fff",padding:16,borderRadius:18,borderWidth:1,borderColor:"#e2e9df",gap:8},label:{fontSize:12,fontWeight:"800",color:"#34483d",marginTop:6},input:{backgroundColor:"#f9fbf7",borderWidth:1,borderColor:"#dbe5d8",borderRadius:10,paddingHorizontal:12,paddingVertical:11,fontSize:14,color:"#1b3027"},choiceRow:{flexDirection:"row",gap:8,flexWrap:"wrap",alignItems:"center"},choice:{borderRadius:10,borderWidth:1,borderColor:"#dbe5d8",paddingVertical:10,paddingHorizontal:15,backgroundColor:"#fff"},choiceActive:{backgroundColor:"#e6f1e3",borderColor:"#176b48"},choiceText:{fontSize:12,color:"#53655a",fontWeight:"700"},choiceTextActive:{color:"#176b48"},action:{backgroundColor:"#176b48",borderRadius:11,paddingVertical:13,paddingHorizontal:15,alignItems:"center",justifyContent:"center",marginTop:7},actionSecondary:{backgroundColor:"#f2f5ee",borderWidth:1,borderColor:"#dbe5d8"},actionCompact:{paddingVertical:9,paddingHorizontal:12,marginTop:0},actionText:{fontSize:12,fontWeight:"900",color:"#fff"},actionTextSecondary:{color:"#176b48"},disabled:{opacity:.55},helper:{fontSize:12,lineHeight:18,color:"#718077"},error:{backgroundColor:"#fff0ed",borderRadius:10,color:"#a33525",padding:12,lineHeight:18},link:{color:"#176b48",fontSize:12,fontWeight:"900"},hero:{padding:18,backgroundColor:"#e6efdc",borderRadius:20,gap:7},onlineRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginTop:8,paddingTop:12,borderTopWidth:1,borderTopColor:"#cfdec7"},onlineTitle:{fontSize:15,fontWeight:"900",color:"#1b3027"},metrics:{flexDirection:"row",gap:9},metric:{flex:1,backgroundColor:"#fff",borderWidth:1,borderColor:"#e2e9df",borderRadius:14,padding:12},metricValue:{fontSize:20,fontWeight:"900",color:"#176b48"},sectionHead:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginTop:8},heading:{fontSize:19,fontWeight:"900",color:"#1b3027"},orderCard:{backgroundColor:"#fff",padding:15,borderRadius:16,borderWidth:1,borderColor:"#e2e9df",gap:9},orderHead:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8},orderCode:{fontSize:15,fontWeight:"900",color:"#1b3027"},status:{backgroundColor:"#edf5e9",color:"#176b48",paddingVertical:5,paddingHorizontal:8,borderRadius:9,fontSize:10,fontWeight:"900",overflow:"hidden"},customer:{fontSize:18,fontWeight:"900",color:"#176b48"},body:{fontSize:12,lineHeight:18,color:"#46564b"},detail:{paddingTop:8,borderTopWidth:1,borderTopColor:"#edf0e8",gap:4},money:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",paddingTop:10,borderTopWidth:1,borderTopColor:"#edf0e8"},amount:{fontSize:18,fontWeight:"900",color:"#176b48"},note:{fontSize:12,color:"#99611f",lineHeight:18}
});
