import os
import tempfile
import unittest

db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
db_file.close()
os.environ["DATABASE_URL"] = "sqlite:///" + db_file.name
os.environ["APP_ENV"] = "development"
os.environ["JWT_SECRET"] = "test-secret-with-sufficient-length-for-tests"
os.environ["AGENT_DEMO_CODE"] = "123456"
os.environ["PARTNER_ADMIN_TOKEN"] = "test-partner-admin-token-that-is-long-enough"
os.environ["ADMIN_SERVICE_URL"] = ""
os.environ["DISPATCH_SHARED_SECRET"] = "test-dispatch-secret-that-is-long-enough"

from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)


class AgentApiTests(unittest.TestCase):
    def login(self, phone, name="Test Partner"):
        response = client.post("/api/auth/demo-login", json={"phone": phone, "code": "123456", "full_name": name})
        self.assertEqual(response.status_code, 200, response.text)
        return {"Authorization": "Bearer " + response.json()["access_token"]}

    def test_auth_required(self):
        response = client.get("/api/orders")
        self.assertEqual(response.status_code, 401)

    def test_profile_and_online_state(self):
        headers = self.login("+919800000101")
        from backend.app.main import Agent, SessionLocal
        with SessionLocal() as db:
            agent = db.query(Agent).filter_by(phone="+919800000101").first()
            agent.is_verified = True
            db.commit()
        response = client.patch("/api/me", headers=headers, json={"is_online": True, "vehicle_type": "Scooter"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["is_online"])
        self.assertEqual(response.json()["vehicle_type"], "Scooter")

    def test_admin_approval_enables_agent_online_state(self):
        headers = self.login("+919800000106")
        blocked = client.patch("/api/me", headers=headers, json={"is_online": True})
        self.assertEqual(blocked.status_code, 403)
        approved = client.post("/api/internal/admin-approval", headers={"Authorization": "Bearer test-partner-admin-token-that-is-long-enough"}, json={"phone": "+919800000106", "status": "approved"})
        self.assertEqual(approved.status_code, 200, approved.text)
        online = client.patch("/api/me", headers=headers, json={"is_online": True})
        self.assertEqual(online.status_code, 200, online.text)
        self.assertTrue(online.json()["is_verified"])

    def test_unapproved_agent_cannot_go_online(self):
        headers = self.login("+919800000103")
        response = client.patch("/api/me", headers=headers, json={"is_online": True})
        self.assertEqual(response.status_code, 403)
        self.assertIn("awaiting admin approval", response.json()["detail"])

    def test_seed_and_delivery_lifecycle(self):
        headers = self.login("+919800000102")
        seed = client.post("/api/dev/seed", headers=headers)
        self.assertEqual(seed.status_code, 200)
        orders = client.get("/api/orders", headers=headers).json()
        self.assertGreaterEqual(len(orders), 1)
        order = next(o for o in orders if o["status"] == "assigned")
        oid = order["id"]
        accept = client.patch(f"/api/orders/{oid}/action", headers=headers, json={"action": "accept"})
        self.assertEqual(accept.status_code, 200, accept.text)
        pickup_arrival = client.patch(f"/api/orders/{oid}/action", headers=headers, json={"action": "arrived_at_pickup"})
        self.assertEqual(pickup_arrival.status_code, 200, pickup_arrival.text)
        pickup = client.patch(f"/api/orders/{oid}/action", headers=headers, json={"action": "picked_up"})
        self.assertEqual(pickup.status_code, 200, pickup.text)
        customer_arrival = client.patch(f"/api/orders/{oid}/action", headers=headers, json={"action": "arrived_at_customer"})
        self.assertEqual(customer_arrival.status_code, 200, customer_arrival.text)
        no_proof = client.patch(f"/api/orders/{oid}/action", headers=headers, json={"action": "delivered"})
        self.assertEqual(no_proof.status_code, 422)
        delivered = client.patch(f"/api/orders/{oid}/action", headers=headers, json={
            "action": "delivered", "proof_note": "Handed to customer at front door"
        })
        self.assertEqual(delivered.status_code, 200, delivered.text)
        self.assertEqual(delivered.json()["status"], "delivered")

    def test_multi_shop_dispatch_requires_each_pickup_before_delivery(self):
        headers = self.login("+919800000121", "Multi Stop Agent")
        from backend.app.main import Agent, SessionLocal
        with SessionLocal() as db:
            for existing in db.query(Agent).all():
                existing.is_online = False
            agent = db.query(Agent).filter_by(phone="+919800000121").first()
            agent.is_verified = True
            agent.is_online = True
            db.commit()
        body = {
            "public_code": "VGZ-MULTI-STOP-121",
            "customer_name": "Multi Stop Customer",
            "customer_phone": "+919800000122",
            "delivery_address": "12 Test Road, Hubli",
            "delivery_city": "Hubli",
            "pickup_stops": [
                {"shop_name": "Veg Shop", "shop_phone": "+919800000123", "pickup_address": "1 Veg Market", "item_summary": "Tomato x1", "shop_order_id": "veg-1"},
                {"shop_name": "Grocery Shop", "shop_phone": "+919800000124", "pickup_address": "2 Grocery Street", "item_summary": "Rice x1", "shop_order_id": "grocery-1"}
            ],
            "total_amount": "100.00",
            "delivery_fee": "25.00",
            "payment_method": "cod",
            "payment_status": "pending"
        }
        dispatched = client.post("/api/internal/dispatch", headers={"Authorization": "Bearer test-dispatch-secret-that-is-long-enough"}, json=body)
        self.assertEqual(dispatched.status_code, 201, dispatched.text)
        oid = dispatched.json()["id"]
        for action in ["accept", "arrived_at_pickup", "picked_up"]:
            result = client.patch(f"/api/orders/{oid}/action", headers=headers, json={"action": action})
            self.assertEqual(result.status_code, 200, result.text)
        first_pickup = client.get(f"/api/orders/{oid}", headers=headers).json()
        self.assertEqual(first_pickup["status"], "accepted")
        self.assertEqual(first_pickup["pickup_progress"], 1)
        self.assertEqual(first_pickup["pickup_stops"][0]["shop_name"], "Veg Shop")
        for action in ["arrived_at_pickup", "picked_up"]:
            result = client.patch(f"/api/orders/{oid}/action", headers=headers, json={"action": action})
            self.assertEqual(result.status_code, 200, result.text)
        second_pickup = client.get(f"/api/orders/{oid}", headers=headers).json()
        self.assertEqual(second_pickup["status"], "picked_up")
        self.assertEqual(second_pickup["pickup_progress"], 1)
        for action in ["arrived_at_customer"]:
            result = client.patch(f"/api/orders/{oid}/action", headers=headers, json={"action": action})
            self.assertEqual(result.status_code, 200, result.text)
        delivered = client.patch(f"/api/orders/{oid}/action", headers=headers, json={
            "action": "delivered", "proof_note": "Delivered to customer"
        })
        self.assertEqual(delivered.status_code, 200, delivered.text)
        self.assertEqual(delivered.json()["status"], "delivered")

    def test_cannot_view_another_agents_order(self):
        headers_a = self.login("+919800000103")
        headers_b = self.login("+919800000104")
        client.post("/api/dev/seed", headers=headers_a)
        order = client.get("/api/orders", headers=headers_a).json()[0]
        response = client.get(f"/api/orders/{order['id']}", headers=headers_b)
        self.assertEqual(response.status_code, 404)

    def test_delivery_requires_proof_note(self):
        headers = self.login("+919800000105")
        client.post("/api/dev/seed", headers=headers)
        # Test the explicitly guarded terminal transition after driving through the valid flow.
        order = next(o for o in client.get("/api/orders", headers=headers).json() if o["status"] == "assigned")
        for action in ["accept", "arrived_at_pickup", "picked_up", "arrived_at_customer"]:
            response = client.patch(f"/api/orders/{order['id']}/action", headers=headers, json={"action": action})
            self.assertEqual(response.status_code, 200, response.text)
        response = client.patch(f"/api/orders/{order['id']}/action", headers=headers, json={"action": "delivered"})
        self.assertEqual(response.status_code, 422)


    def test_mobile_registration_is_sent_to_admin_review_queue(self):
        from unittest.mock import Mock, patch
        with patch("backend.app.main.ADMIN_SERVICE_URL", "http://admin.test"), patch("backend.app.main.httpx.post", return_value=Mock(raise_for_status=Mock())) as callback:
            response = client.post("/api/auth/demo-login", json={
                "phone": "9876543215", "code": "123456", "full_name": "New Partner", "city": "Hubli"
            })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["agent"]["is_verified"])
        args, kwargs = callback.call_args
        self.assertEqual(args[0], "http://admin.test/api/internal/partner-requests/agent")
        self.assertEqual(kwargs["json"]["phone"], "+919876543215")
        self.assertEqual(kwargs["json"]["city"], "Hubli")

if __name__ == "__main__":
    unittest.main()
