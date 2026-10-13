import os
import tempfile
import unittest

db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
db_file.close()
os.environ["DATABASE_URL"] = "sqlite:///" + db_file.name
os.environ["APP_ENV"] = "development"
os.environ["JWT_SECRET"] = "test-secret-with-sufficient-length-for-tests"
os.environ["AGENT_DEMO_CODE"] = "123456"

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
        response = client.patch("/api/me", headers=headers, json={"is_online": True, "vehicle_type": "Scooter"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["is_online"])
        self.assertEqual(response.json()["vehicle_type"], "Scooter")

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


if __name__ == "__main__":
    unittest.main()
