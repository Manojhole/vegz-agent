# VEGZ Agent — MVP Optimization Plan

## In-scope before GPS and payment gateway
- Enforce assignment ownership for every delivery action.
- Validate allowed status transitions and require a completion note for exceptions.
- Add delivery proof support later (photo/OTP/signature) with consent and retention rules.
- Keep agent availability synchronized with Admin and handle downstream API failures with retries/logging.
- Add pagination and clear empty/error states to delivery lists.
- Avoid storing precise location until location tracking is intentionally enabled and privacy/retention requirements are defined.
- Require unique service-to-service secrets in production; remove demo login from production builds.

## B2B bulk delivery requirements
- Bulk jobs should include business contact, pickup, delivery window, package count/weight and handling notes.
- Support scheduled delivery and multi-stop routes as a later dispatch improvement.
- Agents must not alter quoted prices or mark payments as received.
- Add an auditable exception flow for short supply, damaged goods, customer unavailable and partial delivery.

## Acceptance checks
- Unassigned agents cannot read or update another agent's deliveries.
- Illegal status transitions are rejected.
- Agent availability changes are reflected in Admin or surfaced as a sync error.
- No precise GPS data is collected until the location feature is explicitly enabled.
