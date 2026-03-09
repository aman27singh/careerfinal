"""AWS Lambda entry point for CareerOS FastAPI application.

Wraps the FastAPI app with Mangum so it can be invoked by:
  - API Gateway HTTP API (v2)  ← recommended
  - API Gateway REST API (v1)
  - Lambda Function URLs

Local development
-----------------
Use uvicorn directly — this file is NOT imported locally:

    AWS_REGION=us-east-1 .venv/bin/uvicorn app.main:app --reload --port 8000

Deployment
----------
    bash deploy/deploy_backend.sh

Environment variables (Lambda)
------------------------------
AWS_REGION               Required — e.g. us-east-1
CAREEROS_RESUME_BUCKET   S3 bucket for resume storage
CAREEROS_CW_LOG_GROUP    CloudWatch log group (optional — Lambda logs anyway)
LOG_LEVEL                DEBUG / INFO / WARNING (default: INFO)
"""
from app.logging_config import configure_logging

# Configure structured logging before anything else is imported
configure_logging()

import logging  # noqa: E402
from mangum import Mangum  # noqa: E402
from app.main import app   # noqa: E402

_log = logging.getLogger(__name__)

# Mangum adapter — translates API Gateway events ↔ ASGI
_mangum = Mangum(app, lifespan="off")


def handler(event, context):
    """Entry point.

    Handles three event types:
    1. Internal async roadmap generation  →  run roadmap pipeline directly
    2. EventBridge scheduled events        →  run market refresh directly
    3. Everything else (API Gateway)       →  delegate to Mangum / FastAPI
    """
    # ── Internal async roadmap generation ─────────────────────────────────────
    if event.get("_internal") == "generate_roadmap":
        _log.info("Internal async roadmap generation for user=%s role=%s",
                   event.get("user_id"), event.get("target_role"))
        try:
            from app.main import _generate_roadmap_internal
            _generate_roadmap_internal(event)
            _log.info("Async roadmap generation completed for user=%s", event.get("user_id"))
        except Exception as exc:
            _log.error("Async roadmap generation failed: %s", exc)
            # Mark as failed in DynamoDB so frontend stops polling
            try:
                from app.services import user_store
                user_store.update_user(event["user_id"], {
                    "dynamic_roadmap": {
                        "status": "failed",
                        "error": str(exc)[:200],
                        "target_role": event.get("target_role", ""),
                    }
                })
            except Exception:
                pass
        return {"statusCode": 200, "body": "roadmap generation handled"}

    # EventBridge scheduled rule: {"source": "aws.events", "detail-type": "Scheduled Event"}
    if event.get("source") == "aws.events":
        _log.info("EventBridge scheduled trigger — running weekly market refresh")
        try:
            from app.services import market_service
            result = market_service.refresh_market_data(write=True)
            if result.get("roles_updated", 0) > 0:
                import app.services.role_engine as _re
                import app.services.skill_impact_engine as _sie
                _re.MARKET_DATA = market_service.get_market_data()
                _sie._market_data = None
            _log.info("Weekly market refresh complete: %s", result)
        except Exception as exc:
            _log.error("Weekly market refresh failed: %s", exc)
        return {"statusCode": 200, "body": "market refresh complete"}

    # Default: API Gateway / Function URL → Mangum
    return _mangum(event, context)
