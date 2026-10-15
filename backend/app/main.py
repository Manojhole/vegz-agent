import json
import os
import re
import secrets
import httpx
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

import jwt
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, create_engine, select, desc, func
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

load_dotenv()
APP_ENV = os.getenv("APP_ENV", "development").lower()
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./vegz_agent.db")
JWT_SECRET = os.getenv("JWT_SECRET", "local-dev-only-change-this-secret")
PARTNER_ADMIN_TOKEN = os.getenv("PARTNER_ADMIN_TOKEN", "vegz-local-partner-token-change-before-production")
DISPATCH_SHARED_SECRET = os.getenv("DISPATCH_SHARED_SECRET", "vegz-local-agent-dispatch-token-change-before-production" if APP_ENV == "development" else "")
ADMIN_SERVICE_URL = os.getenv("ADMIN_SERVICE_URL", "http://host.docker.internal:8000" if APP_ENV == "development" else "").rstrip("/")
if APP_ENV == "production" and (len(PARTNER_ADMIN_TOKEN) < 32 or "replace-with" in PARTNER_ADMIN_TOKEN.lower() or "change-before-production" in PARTNER_ADMIN_TOKEN or not ADMIN_SERVICE_URL):
    raise RuntimeError("Configure ADMIN_SERVICE_URL and a unique PARTNER_ADMIN_TOKEN before production.")
engine_kwargs = {"pool_pre_ping": True}
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
engine = create_engine(DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


class Agent(Base):
    __tablename__ = "agents"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120), default="Delivery Partner")
    vehicle_type: Mapped[str] = mapped_column(String(30), default="Bike")
    vehicle_number: Mapped[str] = mapped_column(String(20), default="")
    city: Mapped[str] = mapped_column(String(100), default="Hubli", index=True)
    is_online: Mapped[bool] = mapped_column(Boolean, default=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DeliveryOrder(Base):
    __tablename__ = "delivery_orders"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    public_code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    agent_id: Mapped[int | None] = mapped_column(ForeignKey("agents.id"), nullable=True, index=True)
    shop_name: Mapped[str] = mapped_column(String(120), default="Vegz Partner Shop")
    pickup_stops: Mapped[str] = mapped_column(Text, default="[]")
    pickup_progress: Mapped[int] = mapped_column(Integer, default=0)
    shop_phone: Mapped[str] = mapped_column(String(20), default="")
    pickup_address: Mapped[str] = mapped_column(String(400), default="")
    customer_name: Mapped[str] = mapped_column(String(120), default="Vegz customer")
    customer_phone: Mapped[str] = mapped_column(String(20), default="")
    delivery_address: Mapped[str] = mapped_column(String(500), default="")
    delivery_city: Mapped[str] = mapped_column(String(100), default="Hubli", index=True)
    delivery_instructions: Mapped[str] = mapped_column(String(300), default="")
    item_summary: Mapped[str] = mapped_column(Text, default="")
    total_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    delivery_fee: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    payment_method: Mapped[str] = mapped_column(String(24), default="cash")
    payment_status: Mapped[str] = mapped_column(String(24), default="pending")
    status: Mapped[str] = mapped_column(String(32), default="assigned", index=True)
    decline_reason: Mapped[str] = mapped_column(String(200), default="")
    failure_reason: Mapped[str] = mapped_column(String(300), default="")
    failed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    delivery_attempts: Mapped[int] = mapped_column(Integer, default=0)
    pickup_lat: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    pickup_lng: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    delivery_lat: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    delivery_lng: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    proof_note: Mapped[str] = mapped_column(String(300), default="")
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    picked_up_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


Base.metadata.create_all(bind=engine)
with engine.begin() as connection:
    columns = {column["name"] for column in __import__("sqlalchemy").inspect(engine).get_columns("delivery_orders")}
    if "pickup_stops" not in columns:
        connection.execute(__import__("sqlalchemy").text("ALTER TABLE delivery_orders ADD COLUMN pickup_stops TEXT NOT NULL DEFAULT '[]'"))
    if "pickup_progress" not in columns:
        connection.execute(__import__("sqlalchemy").text("ALTER TABLE delivery_orders ADD COLUMN pickup_progress INTEGER NOT NULL DEFAULT 0"))
    if "delivery_city" not in columns:
        connection.execute(__import__("sqlalchemy").text("ALTER TABLE delivery_orders ADD COLUMN delivery_city VARCHAR(100) NOT NULL DEFAULT 'Hubli'"))
    if "failure_reason" not in columns:
        connection.execute(__import__("sqlalchemy").text("ALTER TABLE delivery_orders ADD COLUMN failure_reason VARCHAR(300) NOT NULL DEFAULT ''"))
    if "failed_at" not in columns:
        connection.execute(__import__("sqlalchemy").text("ALTER TABLE delivery_orders ADD COLUMN failed_at DATETIME"))
    if "delivery_attempts" not in columns:
        connection.execute(__import__("sqlalchemy").text("ALTER TABLE delivery_orders ADD COLUMN delivery_attempts INTEGER NOT NULL DEFAULT 0"))
    agent_columns = {column["name"] for column in __import__("sqlalchemy").inspect(engine).get_columns("agents")}
    if "city" not in agent_columns:
        connection.execute(__import__("sqlalchemy").text("ALTER TABLE agents ADD COLUMN city VARCHAR(100) NOT NULL DEFAULT 'Hubli'"))

app = FastAPI(title="Vegz Agent API", version="1.0.0", description="Delivery agent operations, availability and order progress.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in os.getenv("CORS_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000").split(",") if x.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class DemoLogin(BaseModel):
    phone: str = Field(min_length=8, max_length=20)
    code: str = Field(min_length=4, max_length=10)
    full_name: str = Field(default="Delivery Partner", min_length=2, max_length=120)
    city: str = Field(default="Hubli", min_length=2, max_length=100)


class AgentProfilePatch(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    vehicle_type: str | None = Field(default=None, max_length=30)
    vehicle_number: str | None = Field(default=None, max_length=20)
    city: str | None = Field(default=None, min_length=2, max_length=100)
    is_online: bool | None = None


class OrderAction(BaseModel):
    action: str
    reason: str = Field(default="", max_length=200)
    proof_note: str = Field(default="", max_length=300)


class LocationUpdate(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_meters: float | None = Field(default=None, ge=0, le=100000)


def agent_payload(agent: Agent):
    return {
        "id": agent.id, "phone": agent.phone, "full_name": agent.full_name,
        "vehicle_type": agent.vehicle_type, "vehicle_number": agent.vehicle_number, "city": agent.city,
        "is_online": agent.is_online, "is_verified": agent.is_verified,
        "created_at": (agent.created_at or datetime.utcnow()).isoformat() + "Z",
    }


def order_payload(o: DeliveryOrder):
    return {
        "id": o.id, "code": o.public_code, "shop_name": o.shop_name, "shop_phone": o.shop_phone,
        "pickup_stops": json.loads(o.pickup_stops or "[]"), "pickup_progress": o.pickup_progress,
        "pickup_address": o.pickup_address, "customer_name": o.customer_name, "customer_phone": o.customer_phone,
        "delivery_address": o.delivery_address, "delivery_city": o.delivery_city, "delivery_instructions": o.delivery_instructions,
        "item_summary": o.item_summary, "total_amount": float(o.total_amount or 0),
        "delivery_fee": float(o.delivery_fee or 0), "payment_method": o.payment_method,
        "payment_status": o.payment_status, "status": o.status, "decline_reason": o.decline_reason,
        "failure_reason": o.failure_reason, "failed_at": o.failed_at.isoformat() + "Z" if o.failed_at else None,
        "delivery_attempts": o.delivery_attempts,
        "proof_note": o.proof_note, "assigned_at": o.assigned_at.isoformat() + "Z",
        "accepted_at": o.accepted_at.isoformat() + "Z" if o.accepted_at else None,
        "picked_up_at": o.picked_up_at.isoformat() + "Z" if o.picked_up_at else None,
        "delivered_at": o.delivered_at.isoformat() + "Z" if o.delivered_at else None,
        "updated_at": o.updated_at.isoformat() + "Z",
    }


def current_agent(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> Agent:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in as a delivery agent first.")
    try:
        payload = jwt.decode(authorization.split(" ", 1)[1].strip(), JWT_SECRET, algorithms=["HS256"])
        agent_id = int(payload["agent_id"])
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    agent = db.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=401, detail="Delivery agent account not found.")
    return agent


class DispatchStop(BaseModel):
    shop_name: str = Field(min_length=2, max_length=120)
    shop_phone: str = Field(default="", max_length=20)
    pickup_address: str = Field(min_length=3, max_length=400)
    item_summary: str = Field(default="", max_length=2000)
    shop_order_id: str = Field(default="", max_length=80)


class InternalDispatch(BaseModel):
    public_code: str = Field(min_length=4, max_length=32)
    customer_name: str = Field(min_length=2, max_length=120)
    customer_phone: str = Field(default="", max_length=20)
    delivery_address: str = Field(min_length=4, max_length=500)
    delivery_instructions: str = Field(default="", max_length=300)
    pickup_stops: list[DispatchStop] = Field(min_length=1, max_length=10)
    total_amount: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    delivery_fee: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    payment_method: str = Field(default="cod", max_length=24)
    payment_status: str = Field(default="pending", max_length=24)
    delivery_city: str = Field(default="Hubli", min_length=2, max_length=100)


@app.get("/api/internal/availability")
def internal_dispatch_availability(city: str = Query(default="Hubli", min_length=2, max_length=100), authorization: str | None = Header(default=None), db: Session = Depends(get_db)): 
    expected = DISPATCH_SHARED_SECRET
    supplied = authorization.split(" ", 1)[1].strip() if authorization and authorization.lower().startswith("bearer ") else ""
    if len(expected) < 32 or "replace-with" in expected.lower() or not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Internal dispatch authentication failed.")
    normalized_city = " ".join(city.split()).casefold()
    query = select(Agent).where(Agent.is_online.is_(True), func.lower(Agent.city) == normalized_city)
    query = query.where(Agent.is_verified.is_(True))
    agent = db.scalar(query.order_by(Agent.created_at))
    return {"available": agent is not None, "city": " ".join(city.split()).title()}


@app.post("/api/internal/dispatch", status_code=201)
def create_dispatch(
    payload: InternalDispatch,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Internal dispatch contract for the user/order service; protect with a shared secret."""
    expected = os.getenv("DISPATCH_SHARED_SECRET", "")
    supplied = authorization.split(" ", 1)[1].strip() if authorization and authorization.lower().startswith("bearer ") else ""
    if len(expected) < 32 or "replace-with" in expected.lower() or not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Internal dispatch authentication failed.")
    existing_order = db.scalar(select(DeliveryOrder).where(DeliveryOrder.public_code == payload.public_code))
    if existing_order is not None:
        return order_payload(existing_order)
    stops = [stop.model_dump() for stop in payload.pickup_stops]
    primary = stops[0]
    delivery_city = " ".join(payload.delivery_city.split()).title()
    agent_query = select(Agent).where(Agent.is_online.is_(True), func.lower(Agent.city) == delivery_city.casefold())
    agent_query = agent_query.where(Agent.is_verified.is_(True))
    agent = db.scalar(agent_query.order_by(Agent.created_at))
    if agent is None:
        raise HTTPException(status_code=409, detail="No eligible agent is currently online. Ask an agent to go online and retry.")
    order = DeliveryOrder(
        public_code=payload.public_code,
        agent_id=agent.id if agent else None,
        shop_name=primary["shop_name"],
        shop_phone=primary["shop_phone"],
        pickup_address=primary["pickup_address"],
        pickup_stops=json.dumps(stops),
        customer_name=payload.customer_name,
        customer_phone=payload.customer_phone,
        delivery_address=payload.delivery_address,
        delivery_city=delivery_city,
        delivery_instructions=payload.delivery_instructions,
        item_summary="; ".join(f'{stop["shop_name"]}: {stop["item_summary"]}' for stop in stops),
        total_amount=payload.total_amount,
        delivery_fee=payload.delivery_fee,
        payment_method=payload.payment_method,
        payment_status=payload.payment_status,
        status="assigned",
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return order_payload(order)


class AdminApprovalIn(BaseModel):
    phone: str = Field(min_length=8, max_length=24)
    status: str = Field(pattern=r"^(approved|rejected|suspended|pending)$")


@app.post("/api/internal/admin-approval")
def admin_approval(payload: AdminApprovalIn, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    expected = PARTNER_ADMIN_TOKEN
    supplied = authorization.split(" ", 1)[1].strip() if authorization and authorization.lower().startswith("bearer ") else ""
    if len(expected) < 32 or not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Partner approval authentication failed.")
    digits = re.sub(r"\D", "", payload.phone)
    phone = "+91" + digits[-10:] if len(digits) >= 10 and (len(digits) == 10 or digits.startswith("91")) else re.sub(r"[^0-9+]", "", payload.phone)
    agent = db.scalar(select(Agent).where(Agent.phone == phone))
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent registration not found.")
    agent.is_verified = payload.status == "approved"
    if not agent.is_verified:
        agent.is_online = False
    db.commit()
    db.refresh(agent)
    return agent_payload(agent)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "vegz-agent-api"}


@app.post("/api/auth/demo-login")
def demo_login(payload: DemoLogin, db: Session = Depends(get_db)):
    """Development-only sign-in. Production must use verified phone OTP and agent approval."""
    if APP_ENV == "production":
        raise HTTPException(status_code=503, detail="Configure verified OTP authentication before production sign-in.")
    digits = re.sub(r"\D", "", payload.phone)
    if len(digits) >= 12 and digits.startswith("91"):
        digits = digits[-10:]
    if len(digits) == 10:
        phone = "+91" + digits
    elif len(digits) >= 8:
        phone = "+" + digits
    else:
        phone = ""
    if len(digits) < 8:
        raise HTTPException(status_code=400, detail="Enter a valid mobile number.")
    if payload.code != os.getenv("AGENT_DEMO_CODE", "123456"):
        raise HTTPException(status_code=400, detail="Invalid development access code.")
    agent = db.scalar(select(Agent).where(Agent.phone == phone))
    city = " ".join(payload.city.split()).title()
    if agent is None:
        agent = Agent(phone=phone, full_name=payload.full_name, city=city, is_verified=False)
        db.add(agent)
    else:
        agent.full_name = payload.full_name
        agent.city = city
    db.commit()
    db.refresh(agent)
    admin_url = ADMIN_SERVICE_URL
    admin_token = PARTNER_ADMIN_TOKEN
    if admin_url and len(admin_token) >= 32:
        try:
            response = httpx.post(admin_url + "/api/internal/partner-requests/agent", headers={"Authorization": "Bearer " + admin_token}, json={
                "full_name": agent.full_name, "phone": agent.phone, "city": agent.city,
                "vehicle_type": agent.vehicle_type, "vehicle_number": agent.vehicle_number, "external_ref": str(agent.id)
            }, timeout=5.0)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=503, detail="Could not submit delivery partner registration for admin review. Check the Vegz Admin service and shared partner token.") from exc
    token = jwt.encode({"agent_id": agent.id, "exp": datetime.utcnow() + timedelta(days=7)}, JWT_SECRET, algorithm="HS256")
    return {"access_token": token, "token_type": "bearer", "agent": agent_payload(agent)}


@app.get("/api/me")
def get_me(agent: Agent = Depends(current_agent)):
    return agent_payload(agent)


@app.patch("/api/me")
def update_me(payload: AgentProfilePatch, agent: Agent = Depends(current_agent), db: Session = Depends(get_db)):
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("is_online") is True and not agent.is_verified:
        raise HTTPException(status_code=403, detail="Your delivery partner application is awaiting admin approval. You can go online after approval.")
    if changes.get("city"):
        changes["city"] = " ".join(changes["city"].split()).title()
    if changes.get("city") and changes["city"] != agent.city and changes.get("is_online", agent.is_online):
        raise HTTPException(status_code=409, detail="Go offline before changing your delivery city.")
    for key, value in changes.items():
        setattr(agent, key, value)
    db.commit()
    db.refresh(agent)
    return agent_payload(agent)


@app.get("/api/dashboard")
def dashboard(agent: Agent = Depends(current_agent), db: Session = Depends(get_db)):
    orders = db.scalars(select(DeliveryOrder).where(DeliveryOrder.agent_id == agent.id).order_by(desc(DeliveryOrder.assigned_at))).all()
    active = [o for o in orders if o.status not in {"delivered", "cancelled", "declined"}]
    today = datetime.utcnow().date()
    done_today = [o for o in orders if o.delivered_at and o.delivered_at.date() == today]
    fees = sum(float(o.delivery_fee or 0) for o in done_today)
    return {
        "agent": agent_payload(agent),
        "metrics": {
            "active_deliveries": len(active),
            "delivered_today": len(done_today),
            "delivery_fees_today": round(fees, 2),
            "is_online": agent.is_online,
        },
        "active_orders": [order_payload(o) for o in active],
        "recent_deliveries": [order_payload(o) for o in orders[:5]],
    }


@app.get("/api/orders")
def list_orders(status_filter: str | None = None, agent: Agent = Depends(current_agent), db: Session = Depends(get_db)):
    query = select(DeliveryOrder).where(DeliveryOrder.agent_id == agent.id).order_by(desc(DeliveryOrder.assigned_at))
    if status_filter:
        query = query.where(DeliveryOrder.status == status_filter)
    return [order_payload(o) for o in db.scalars(query).all()]


@app.get("/api/orders/{order_id}")
def get_order(order_id: int, agent: Agent = Depends(current_agent), db: Session = Depends(get_db)):
    order = db.scalar(select(DeliveryOrder).where(DeliveryOrder.id == order_id, DeliveryOrder.agent_id == agent.id))
    if order is None:
        raise HTTPException(status_code=404, detail="This delivery was not assigned to your account.")
    return order_payload(order)


@app.patch("/api/orders/{order_id}/action")
def order_action(order_id: int, payload: OrderAction, agent: Agent = Depends(current_agent), db: Session = Depends(get_db)):
    order = db.scalar(select(DeliveryOrder).where(DeliveryOrder.id == order_id, DeliveryOrder.agent_id == agent.id))
    if order is None:
        raise HTTPException(status_code=404, detail="This delivery was not assigned to your account.")
    action = payload.action.strip().lower()
    now = datetime.utcnow()
    transitions = {
        "assigned": {"accept", "decline"},
        "accepted": {"arrived_at_pickup", "cancel_assignment"},
        "arrived_at_pickup": {"picked_up", "cancel_assignment"},
        "picked_up": {"arrived_at_customer", "delivery_failed"},
        "arrived_at_customer": {"delivered", "delivery_failed"},
        "delivered": set(),
        "delivery_failed": set(),
        "declined": set(),
        "cancelled": set(),
    }
    if action not in transitions.get(order.status, set()):
        raise HTTPException(status_code=409, detail=f"Action '{action}' is not allowed while status is '{order.status}'.")
    if action == "accept":
        order.status = "accepted"
        order.accepted_at = now
    elif action == "decline":
        if not payload.reason.strip():
            raise HTTPException(status_code=422, detail="Please provide a reason for declining.")
        order.status = "declined"
        order.decline_reason = payload.reason.strip()
        order.agent_id = None
    elif action == "arrived_at_pickup":
        order.status = "arrived_at_pickup"
    elif action == "picked_up":
        try:
            stops = json.loads(order.pickup_stops or "[]")
        except (TypeError, ValueError):
            stops = []
        if stops and order.pickup_progress < len(stops) - 1:
            order.pickup_progress += 1
            order.status = "accepted"
        else:
            order.status = "picked_up"
            order.picked_up_at = now
    elif action == "arrived_at_customer":
        order.status = "arrived_at_customer"
    elif action == "delivery_failed":
        if not payload.reason.strip():
            raise HTTPException(status_code=422, detail="Please provide a reason for the failed delivery.")
        order.status = "delivery_failed"
        order.failure_reason = payload.reason.strip()
        order.failed_at = now
        order.delivery_attempts = (order.delivery_attempts or 0) + 1
        # Release the assignment so dispatch can safely reassign the order.
        order.agent_id = None
    elif action == "delivered":
        if not payload.proof_note.strip():
            raise HTTPException(status_code=422, detail="Add a delivery confirmation note before completing delivery.")
        order.status = "delivered"
        order.proof_note = payload.proof_note.strip()
        order.delivered_at = now
    elif action == "cancel_assignment":
        if not payload.reason.strip():
            raise HTTPException(status_code=422, detail="Please provide a reason for returning this delivery.")
        order.status = "cancelled"
        order.decline_reason = payload.reason.strip()
        order.agent_id = None
    order.updated_at = now
    db.commit()
    db.refresh(order)
    return order_payload(order)


@app.post("/api/location")
def update_location(payload: LocationUpdate, agent: Agent = Depends(current_agent)):
    """Location reporting contract only. Persist/broadcast through a privacy-aware location service before production."""
    if not agent.is_online:
        raise HTTPException(status_code=409, detail="Go online before sharing your location.")
    return {"accepted": True, "recorded": False, "message": "Location endpoint is a stub; live location storage and dispatch integration are not configured."}


@app.post("/api/dev/seed")
def seed_demo_orders(agent: Agent = Depends(current_agent), db: Session = Depends(get_db)):
    """Seeds example deliveries for local development, once per agent."""
    if db.scalar(select(DeliveryOrder.id).where(DeliveryOrder.agent_id == agent.id).limit(1)) is not None:
        return {"message": "Sample deliveries already exist."}
    examples = [
        dict(public_code=f"VGZ-DEMO-{agent.id:03d}-1001", shop_name="Green Basket Market", shop_phone="+919900000001",
             pickup_address="12 Market Road, Main Bazaar", customer_name="Ananya Rao", customer_phone="+919900000011",
             delivery_address="24 Lake View Street, Ward 3", delivery_instructions="Call on arrival. Blue gate.",
             item_summary="Tomato 2 kg, Potato 1 kg, Spinach 1 bunch", total_amount=Decimal("168.00"),
             delivery_fee=Decimal("25.00"), payment_method="cash", payment_status="pending", status="assigned",
             assigned_at=datetime.utcnow()),
        dict(public_code=f"VGZ-DEMO-{agent.id:03d}-1002", shop_name="Daily Fresh Vegetables", shop_phone="+919900000002",
             pickup_address="5 Station Cross, Vegetable Market", customer_name="Rahul Patil", customer_phone="+919900000022",
             delivery_address="Flat 3B, Shanti Residency, Bus Stand Road", delivery_instructions="Leave with security if unavailable.",
             item_summary="Onion 1 kg, Carrot 500 g", total_amount=Decimal("92.00"),
             delivery_fee=Decimal("0.00"), payment_method="online", payment_status="paid", status="accepted",
             assigned_at=datetime.utcnow() - timedelta(minutes=22), accepted_at=datetime.utcnow() - timedelta(minutes=20)),
    ]
    for data in examples:
        db.add(DeliveryOrder(agent_id=agent.id, **data))
    db.commit()
    return {"message": "Demo deliveries created for this agent."}


frontend_dir = Path(__file__).resolve().parents[2] / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
