import re

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.logging_config import configure_logging
configure_logging()

from app.models import (
    AnalyzeRoleRequest,
    AnalyzeRoleResponse,
    GenerateCareerPlanRequest,
    GenerateCareerPlanResponse,
    GenerateDynamicRoadmapRequest,
    GenerateDynamicRoadmapResponse,
    GenerateRoadmapRequest,
    GenerateRoadmapResponse,
    MasteryLevelItem,
    MarketRefreshResponse,
    MissingSkill,
    ProfileAnalysisResponse,
    GetResourcesRequest,
    GetResourcesResponse,
    GitHubRepo,
    LearningResource,
    RoadmapPhase,
    RoadmapProject,
    RoadmapProjectHints,
    RoadmapChallenge,
    RoadmapResource,
    SkillImpactRequest,
    SkillImpactResponse,
    SkillImpactScoreItem,
    SubmitPhaseRequest,
    SubmitTaskRequest,
    SubmitTaskResponse,
    UserMasteryResponse,
    VerifyChallengeRequest,
    VerifyChallengeResponse,
    VerifyAnswerRequest,
    VerifyAnswerResponse,
)
from app.services.profile_engine import analyze_profile
from app.services.roadmap_engine import generate_roadmap
from app.services.role_engine import analyze_role
from app.services.eval_engine import evaluate_submission
from app.services.utils import load_user_metrics, update_metrics_on_task_submission
from app.services.agent_orchestrator import run_skill_gap_pipeline
from app.services import skill_impact_engine
from app.services import embedding_service
from app.services import resources_engine
from app.services import market_service
from app.services import mastery_tracker
from app.services import s3_service
from app.agents import verification_agent
from app.services import user_store

app = FastAPI(title="CareerOS")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/metrics/{user_id}")
def get_metrics(user_id: str):
    """Return user metrics — DynamoDB is the single source of truth.

    Falls back to a fresh defaults record if DynamoDB has no data yet, and
    supplements with file-based metrics only for first-run bootstrapping.
    """
    from app.services.game_engine import calculate_level, calculate_rank
    from app.services import mastery_tracker

    db_user = user_store.get_user(user_id) or {}

    # ── Build metrics primarily from DynamoDB ────────────────────────────────
    xp = int(db_user.get("xp", 0))
    level = int(db_user.get("level", 0)) or calculate_level(xp)
    streak = int(db_user.get("streak", 0))
    rank = db_user.get("rank") or calculate_rank(level)
    total_completed = int(db_user.get("total_completed_tasks", 0))
    total_assigned = int(db_user.get("total_assigned_tasks", 0))
    exec_score = float(db_user.get("execution_score", 0.0))
    last_sub = db_user.get("last_submission_date")

    learned_skills = db_user.get("learned_skills") or user_store.get_learned_skills(user_id)
    if isinstance(learned_skills, set):
        learned_skills = sorted(learned_skills)

    next_priority = db_user.get("next_priority_skill")

    # ── Compute real skill_distribution from skill_xp map ────────────────────
    skill_xp_map = db_user.get("skill_xp", {})
    if isinstance(skill_xp_map, dict) and skill_xp_map:
        skill_distribution = {k: int(v) for k, v in skill_xp_map.items()}
    else:
        skill_distribution = {}

    # ── Compute real knowledge_map from mastery data ─────────────────────────
    _km_colors = ["var(--accent-primary)", "var(--accent-secondary)", "#8B5CF6", "#F59E0B", "#10B981", "#EF4444"]
    knowledge_map = []
    if learned_skills:
        try:
            mastery = mastery_tracker.compute_mastery_for_all_skills(
                user_skills=learned_skills,
                verified_skills=set(db_user.get("verified_skills") or []),
                skill_xp_map=skill_xp_map if isinstance(skill_xp_map, dict) else {},
            )
            for i, (sk, info) in enumerate(mastery.items()):
                knowledge_map.append({
                    "name": sk,
                    "value": int(info.get("score", 0)),
                    "color": _km_colors[i % len(_km_colors)],
                })
        except Exception:
            pass  # non-fatal
    # Fall back to skill_distribution if mastery scores are all zero or empty
    if (not knowledge_map or all(int(e.get("value", 0)) == 0 for e in knowledge_map)) and skill_distribution:
        knowledge_map = [
            {"name": k, "value": int(v), "color": _km_colors[i % len(_km_colors)]}
            for i, (k, v) in enumerate(sorted(skill_distribution.items(), key=lambda x: -x[1]))
        ]

    # ── Build activity_log (real data stored by feedback_agent, else synthetic) ─
    activity_log = [{"day": e["day"], "xp": int(e.get("xp", 0))} for e in (db_user.get("activity_log") or []) if "day" in e]
    if not activity_log:
        _day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        _activity_dates = db_user.get("activity_dates") or []
        if _activity_dates:
            from datetime import date as _date
            _recent = _activity_dates[-7:]
            _xp_per_day = max(1, xp // max(len(_activity_dates), 1))
            for _d in _recent:
                try:
                    _dt = _date.fromisoformat(_d)
                    activity_log.append({"day": _day_names[_dt.weekday()], "xp": _xp_per_day})
                except Exception:
                    pass

    from app.models import UserMetrics
    metrics = UserMetrics(
        user_id=user_id,
        xp=xp,
        level=level,
        rank=rank,
        streak=streak,
        total_completed_tasks=total_completed,
        total_assigned_tasks=total_assigned,
        execution_score=exec_score,
        last_submission_date=last_sub,
        learned_skills=learned_skills if isinstance(learned_skills, list) else [],
        next_priority_skill=next_priority,
        skill_distribution=skill_distribution,
        knowledge_map=knowledge_map,
        activity_log=activity_log,
    )
    return metrics


@app.post("/sync-skills/{user_id}")
def sync_skills(user_id: str, payload: dict):
    """Sync the frontend's allKnownSkills back to DynamoDB.

    Called whenever the frontend's combined skill set changes so that
    the agentic loop and all agents have the latest user skills.
    """
    skills = payload.get("skills", [])
    if not isinstance(skills, list):
        skills = []
    try:
        user_store.update_user(user_id, {"user_skills": skills})
    except Exception:
        pass
    return {"synced": len(skills)}


def _auto_quality_score(submission_text: str) -> int:
    words = submission_text.strip().split()
    word_count = len(words)
    if word_count < 30:
        score = 40
    elif word_count <= 80:
        score = 65
    else:
        score = 85

    code_like_pattern = re.compile(
        r"[;{}]|\b(def|class|return|import|for|while|if|else|elif)\b|=>|\bconst\b|\bfunction\b"
    )
    if code_like_pattern.search(submission_text):
        score += 10

    return min(score, 100)


@app.post("/submit-task", response_model=SubmitTaskResponse)
def submit_task(payload: SubmitTaskRequest) -> SubmitTaskResponse:
    import logging as _logging
    _log = _logging.getLogger(__name__)

    # ── 1. Evaluate submission via LLM ────────────────────────────────────────
    feedback = evaluate_submission(
        submission_text=payload.submission_text,
        user_id=payload.user_id,
        skill=payload.skill,
    )
    quality_score = feedback.rating

    # ── 2. Update XP / streak / level ────────────────────────────────────────
    updated = update_metrics_on_task_submission(
        payload.user_id,
        quality_score=quality_score,
    )

    # ── 2b. Persist the practised skill so the user's history is remembered ──
    if payload.skill and quality_score >= 40:
        try:
            user_store.add_learned_skill(payload.user_id, payload.skill)
            # Also bump per-skill XP (proportional to rating)
            user_store.update_skill_xp(payload.user_id, payload.skill, max(1, quality_score // 10))
        except Exception as exc:
            _log.warning("add_learned_skill failed (non-fatal): %s", exc)

    # ── 3. Closed-loop re-ranking: determine next priority skill ─────────────
    next_priority_skill: str | None = None
    try:
        # Resolve target_role and user_skills from payload or stored profile
        db_user     = user_store.get_user(payload.user_id) or {}
        target_role = payload.target_role or db_user.get("target_role", "")
        user_skills = payload.user_skills or db_user.get("user_skills") or []

        if target_role:
            # Persist updated profile if new info arrived from the frontend
            if payload.target_role or payload.user_skills:
                user_store.update_user_profile(
                    payload.user_id,
                    target_role,
                    user_skills,
                )

            # Get mastery data for discount calculation
            verified = set(db_user.get("verified_skills", []))
            xp_map   = user_store.get_skill_xp_map(payload.user_id)

            # Compute keyword-based impact scores
            ranked = skill_impact_engine.compute_impact_scores(
                user_skills=user_skills,
                target_role=target_role,
                verified_skills=verified,
                skill_xp_map=xp_map,
            )

            # Extract gap skills (user doesn't have them yet)
            user_skills_lower = {s.lower() for s in user_skills}
            gap_skills  = [r["skill"] for r in ranked if r["skill"].lower() not in user_skills_lower]

            if gap_skills:
                # Blend with semantic embeddings for richer re-ranking signal
                base_scores = {r["skill"]: r["impact_score"] for r in ranked}
                reranked    = embedding_service.rerank_skills_with_embeddings(
                    skills=gap_skills[:20],   # cap to avoid excessive Bedrock calls
                    role=target_role,
                    base_scores=base_scores,
                )
                next_priority_skill = reranked[0]["skill"] if reranked else gap_skills[0]
            elif ranked:
                # All skills known — surface the lowest-mastery one
                next_priority_skill = ranked[-1]["skill"]

            if next_priority_skill:
                user_store.set_next_priority_skill(payload.user_id, next_priority_skill)
                _log.info(
                    "Re-rank complete: user='%s' role='%s' next='%s'",
                    payload.user_id, target_role, next_priority_skill,
                )
    except Exception as exc:
        _log.warning("Re-ranking failed (non-fatal): %s", exc)

    # ── 4. Return enriched response ───────────────────────────────────────────
    return SubmitTaskResponse(
        xp=updated.xp,
        level=updated.level,
        rank=updated.rank,
        streak=updated.streak,
        execution_score=updated.execution_score,
        feedback=feedback,
        next_priority_skill=next_priority_skill,
    )


@app.post("/analyze-profile", response_model=ProfileAnalysisResponse)
def analyze_profile_endpoint(
    resume: UploadFile | None = File(None),
    github_username: str | None = Form(None),
    user_id: str | None = Form(None),
) -> ProfileAnalysisResponse:
    import logging as _logging
    _log = _logging.getLogger(__name__)

    resume_bytes: bytes | None = None
    if resume:
        resume_bytes = resume.file.read()
        # Store resume in S3 (best-effort — don't fail the request if S3 is unavailable)
        try:
            s3_key = s3_service.upload_resume(
                file_bytes=resume_bytes,
                filename=resume.filename or "resume",
                user_id=user_id,
                content_type=resume.content_type or "application/octet-stream",
            )
            _log.info("Resume stored at s3_key=%s user_id=%s", s3_key, user_id)
        except Exception as exc:
            _log.warning("Resume S3 upload skipped: %s", exc)

    result = analyze_profile(resume_bytes, github_username)
    # Persist scan result to DynamoDB so the frontend can reload it
    if user_id:
        try:
            # Extract all skills from scan and persist as user_skills
            scan_skills = list(set(
                (result.get("technical_skills") or []) +
                (result.get("github_analysis", {}).get("primary_languages") or [])
            ))
            persist_data = {"scan_result": result}
            if scan_skills:
                persist_data["user_skills"] = scan_skills
            user_store.update_user(user_id, persist_data)
        except Exception as exc:
            import logging as _l; _l.getLogger(__name__).warning("scan_result persist failed: %s", exc)
    return ProfileAnalysisResponse(**result)


@app.get("/profile-scan/{user_id}")
def get_profile_scan(user_id: str):
    """Return the last saved profile scan result, enriched with quest-learned skills."""
    user = user_store.get_user(user_id) or {}
    scan = user.get("scan_result")
    if not scan:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="No scan result found")

    # Merge learned_skills (from quests) into technical_skills so they appear
    # in the Profile Analysis view.
    learned: list[str] = user.get("learned_skills") or []
    if isinstance(learned, set):
        learned = sorted(learned)
    existing_tech: list[str] = scan.get("technical_skills") or []
    existing_lower = {s.lower() for s in existing_tech}
    # Only add skills not already present (case-insensitive)
    new_from_quests = [s for s in learned if s.lower() not in existing_lower]
    # Return a shallow copy so we don't mutate the stored scan_result
    scan = dict(scan)
    scan["technical_skills"] = existing_tech + new_from_quests
    scan["quest_skills"] = new_from_quests   # front-end uses this to render them distinctly
    return scan


@app.post("/analyze-role", response_model=AnalyzeRoleResponse)
def analyze_role_endpoint(request: AnalyzeRoleRequest) -> AnalyzeRoleResponse:
    result = analyze_role(
        user_skills=request.user_skills,
        selected_role=request.selected_role,
    )
    # Persist gap result + target role + user skills to DynamoDB
    uid = request.user_id or "user_1"
    try:
        user_store.update_user(uid, {
            "gap_result": result,
            "target_role": request.selected_role,
            "user_skills": request.user_skills,
        })
    except Exception:
        pass
    return AnalyzeRoleResponse(**result)


@app.get("/role-gap/{user_id}")
def get_persisted_role_gap(user_id: str):
    """Return the last saved role-gap analysis result for a user."""
    from fastapi import HTTPException
    db_user = user_store.get_user(user_id) or {}
    gap = db_user.get("gap_result")
    if not gap:
        raise HTTPException(status_code=404, detail="No gap result found")
    return gap


@app.post("/generate-roadmap", response_model=GenerateRoadmapResponse)
def generate_roadmap_endpoint(request: GenerateRoadmapRequest) -> GenerateRoadmapResponse:
    missing_skills_list = [
        {"skill": skill.skill, "importance": skill.importance}
        for skill in request.missing_skills
    ]
    result = generate_roadmap(missing_skills_list)
    return GenerateRoadmapResponse(**result)


@app.post("/generate-career-plan", response_model=GenerateCareerPlanResponse)
def generate_career_plan_endpoint(
    request: GenerateCareerPlanRequest,
) -> GenerateCareerPlanResponse:
    # Delegate to the orchestrator: gap_agent → roadmap_agent pipeline
    result = run_skill_gap_pipeline(
        user_skills=request.user_skills,
        selected_role=request.selected_role,
    )

    return GenerateCareerPlanResponse(
        alignment_score=result["alignment_score"],
        missing_skills=[MissingSkill(**skill) for skill in result["missing_skills"]],
        roadmap=result["roadmap"],
        capstone=result["capstone"],
        review=result["review"],
    )


@app.post("/skill-impact", response_model=SkillImpactResponse)
def skill_impact(payload: SkillImpactRequest) -> SkillImpactResponse:
    """Rank every skill gap for the target role by Skill Impact Score.

    The score combines market demand, gap severity, career relevance, and the
    user's current mastery level.  Pass ``user_id`` to have verified skills
    fetched from DynamoDB so the score reflects actual assessed competency.
    """
    # Fetch verified skills + skill_xp_map from DynamoDB if user_id provided
    verified: set[str] = set()
    skill_xp_map: dict[str, int] = {}
    if payload.user_id:
        try:
            user = user_store.get_user(payload.user_id)
            verified = set(user.get("verified_skills", []))
            skill_xp_map = user_store.get_skill_xp_map(payload.user_id)
        except Exception:
            pass  # graceful degradation — proceed without verified skills

    ranked = skill_impact_engine.compute_impact_scores(
        user_skills=payload.user_skills,
        target_role=payload.target_role,
        verified_skills=verified,
        skill_xp_map=skill_xp_map,
    )

    alignment = skill_impact_engine.compute_alignment_score(
        user_skills=payload.user_skills,
        target_role=payload.target_role,
        verified_skills=verified,
    )

    top_priority = skill_impact_engine.get_top_priority_skill(
        user_skills=payload.user_skills,
        target_role=payload.target_role,
        verified_skills=verified,
        skill_xp_map=skill_xp_map,
    )

    return SkillImpactResponse(
        target_role=payload.target_role,
        ranked_skills=[SkillImpactScoreItem(**item) for item in ranked],
        top_priority=top_priority,
        alignment_score=alignment,
    )


@app.post("/verify-skill/challenge", response_model=VerifyChallengeResponse)
def get_skill_challenge(request: VerifyChallengeRequest) -> VerifyChallengeResponse:
    """Generate a challenge question for the requested skill."""
    question = verification_agent.generate_challenge(request.skill)
    return VerifyChallengeResponse(skill=request.skill, question=question)


@app.post("/verify-skill/check", response_model=VerifyAnswerResponse)
def check_skill_answer(request: VerifyAnswerRequest) -> VerifyAnswerResponse:
    """Evaluate a user's answer and return a verification result.

    If *user_id* is provided and the answer is verified (score >= 70),
    the skill is persisted to the user's DynamoDB record.
    """
    result = verification_agent.verify_answer(
        skill=request.skill,
        question=request.question,
        answer=request.answer,
    )

    if request.user_id and result.verified:
        try:
            user_store.add_verified_skill(request.user_id, request.skill)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning(
                "Failed to persist verified skill '%s' for user '%s': %s",
                request.skill, request.user_id, exc,
            )

    return VerifyAnswerResponse(**result.to_dict())


# ── Mastery ───────────────────────────────────────────────────────────────────────

@app.get("/user/{user_id}/mastery", response_model=UserMasteryResponse)
def get_user_mastery(user_id: str) -> UserMasteryResponse:
    """Return per-skill mastery levels for a user.

    Combines self-reported skills, verified skills, accumulated skill XP, and
    GitHub mastery signals (if the user has linked a GitHub account) to produce
    a 5-level mastery assessment (0=unknown → 4=expert) for every skill.
    """
    try:
        user = user_store.get_user(user_id)
    except Exception as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"User '{user_id}' not found") from exc

    user_skills    = user.get("user_skills", []) or user.get("skills", [])
    verified_skills = set(user.get("verified_skills", []))
    skill_xp_map   = user_store.get_skill_xp_map(user_id)

    # GitHub signals if available
    github_mastery_signals: dict[str, float] = {}
    github_username = user.get("github_username")
    if github_username:
        try:
            from app.services.github_service import analyze_github_deep
            gh = analyze_github_deep(github_username)
            github_mastery_signals = gh.get("mastery_signals", {})
        except Exception:
            pass

    mastery_data = mastery_tracker.compute_mastery_for_all_skills(
        user_skills=user_skills,
        verified_skills=verified_skills,
        skill_xp_map=skill_xp_map,
        github_mastery_signals=github_mastery_signals,
    )

    items = [
        MasteryLevelItem(
            skill=skill,
            level=info["level"],
            level_name=info["level_name"],
            mastery_discount=info["mastery_discount"],
            skill_xp=skill_xp_map.get(skill, 0),
        )
        for skill, info in mastery_data.items()
    ]
    # Sort by level descending, then by skill_xp descending
    items.sort(key=lambda x: (x.level, x.skill_xp), reverse=True)

    return UserMasteryResponse(user_id=user_id, mastery_levels=items)


# ── Market Intelligence ──────────────────────────────────────────────────────

@app.post("/market/refresh", response_model=MarketRefreshResponse)
def refresh_market(write: bool = True) -> MarketRefreshResponse:
    """Fetch live job listings and update market_skills.json.

    Pulls from RemoteOK (always) and Adzuna (when ``ADZUNA_APP_ID``/
    ``ADZUNA_APP_KEY`` env vars are set).  Merges 80 live / 20 static.

    Args:
        write: persist updates to market_skills.json in /tmp + S3 (default True).
    """
    result = market_service.refresh_market_data(write=write)

    if write and result.get("roles_updated", 0) > 0:
        # Reload in-process caches so the current Lambda process uses fresh data
        import app.services.role_engine as _re
        import app.services.skill_impact_engine as _sie
        _re.MARKET_DATA = market_service.get_market_data()
        _sie._market_data = None  # force lazy-reload on next call

    return MarketRefreshResponse(**result)


# ── Agentic Intelligence Loop ─────────────────────────────────────────────────

@app.post("/agent/run/{user_id}")
def run_agent(user_id: str):
    """Run the full Agentic Intelligence Loop for a user.

    This is the core of the agentic AI system. It autonomously:
      1. OBSERVE  — gather all available signals about the user's state
      2. REASON   — LLM analyzes the state and decides the highest-impact action
      3. PLAN     — build a structured sequence of tool calls
      4. ACT      — execute each planned tool autonomously
      5. REFLECT  — store results, update user state, return insights

    Unlike every other endpoint (which are reactive — triggered by user clicks),
    this endpoint runs the agent proactively. The frontend polls it regularly
    so the agent continuously works toward the user's career goal.
    """
    from app.agents.agentic_loop import run_agent_loop
    return run_agent_loop(user_id)


# ── Agent: Daily Challenge ────────────────────────────────────────────────────

@app.get("/agent/challenge/{user_id}")
def get_daily_challenge(
    user_id: str,
    skill: str | None = None,
    force_gap: bool = False,
):
    """Generate today's personalised daily challenge.

    Auto-calibrated to the full user profile:
      • SCOUT  — skills from resume + GitHub
      • DELTA  — skill gaps drive 65 % of challenges
      • ATLAS  — current roadmap phase shapes difficulty
      • SAGE   — challenge history avoids repetition + targets mistakes

    Query params:
        skill      — override target skill (optional)
        force_gap  — force a gap-skill challenge (default False)
    """
    from app.agents import challenge_agent
    from app.services import user_store

    db_user = user_store.get_user(user_id) or {}
    mastery_level = int(db_user.get("mastery_level") or 0)

    return challenge_agent.generate(
        user_id=user_id,
        skill=skill,
        mastery_level=mastery_level,
        force_gap=force_gap,
        db_user=db_user,
    )


@app.post("/agent/challenge/{user_id}/evaluate")
def evaluate_challenge(user_id: str, payload: dict):
    """Evaluate a user's answer to their daily challenge.

    Expects JSON body: {"challenge": {...}, "answer": "..."}

    Applies mastery formula: new_mastery = (prev*0.7) + (score/100*4*0.3)
    Updates gap severity and challenge history automatically.
    """
    from app.agents import challenge_agent
    from app.services import user_store

    challenge = payload.get("challenge", {})
    answer = payload.get("answer", "")
    db_user = user_store.get_user(user_id) or {}

    return challenge_agent.evaluate(
        user_id=user_id,
        challenge=challenge,
        answer_text=answer,
        db_user=db_user,
    )


# ── Agent: Project Generation ─────────────────────────────────────────────────

@app.get("/agent/project/{user_id}")
def get_personalized_project(user_id: str):
    """Generate a unique personalised hands-on project for the user.

    Projects are seeded by user_id + skill so each user gets a different
    project and repeated requests return stable results (idempotent seed).
    Includes a 3-level hint system (project_agent).
    """
    from app.agents import project_agent
    from app.services import user_store

    db_user = user_store.get_user(user_id) or {}
    skill = db_user.get("next_priority_skill") or "Python"
    target_role = db_user.get("target_role") or "Software Engineer"
    mastery_level = db_user.get("mastery_level") or 0
    completed_projects = db_user.get("completed_projects") or []
    return project_agent.run(
        user_id=user_id,
        skill=skill,
        target_role=target_role,
        mastery_level=int(mastery_level),
        completed_projects=completed_projects,
    )


@app.post("/agent/project/{user_id}/evaluate")
def evaluate_project(user_id: str, payload: dict):
    """Autonomously evaluate a GitHub repository submission.

    Expects JSON body: {"github_repo_url": "...", "project": {...}, "skill": "..."}
    Fetches the repo, analyses code quality, and returns score + mastery delta.
    """
    from app.agents import evaluation_agent

    return evaluation_agent.run(
        user_id=user_id,
        github_repo_url=payload.get("github_repo_url", ""),
        project=payload.get("project", {}),
        skill=payload.get("skill", ""),
    )


# ── Agent: Precision Resources ────────────────────────────────────────────────

@app.get("/agent/resources/{user_id}")
def get_precision_resources(user_id: str, skill: str | None = None):
    """Return precision-curated learning resources for the user's priority skill.

    Resources include exact doc section URLs, specific course modules, video
    timestamps, and targeted GitHub examples — no generic homepage links
    (resource_agent).
    """
    from app.agents import resource_agent
    from app.services import user_store

    db_user = user_store.get_user(user_id) or {}
    target_skill = skill or db_user.get("next_priority_skill") or "Python"
    target_role = db_user.get("target_role") or "Software Engineer"
    mastery_level = db_user.get("mastery_level") or 0
    return {
        "skill": target_skill,
        "resources": resource_agent.run(
            skill=target_skill,
            target_role=target_role,
            mastery_level=int(mastery_level),
            max_resources=6,
        ),
    }


# ── Agent: Market Intelligence ────────────────────────────────────────────────

@app.get("/agent/market/{user_id}")
def get_market_intelligence(user_id: str):
    """Return live market intelligence for the user's target role.

    Detects emerging skills, computes demand weights, and reports market
    saturation relative to the user's current skill set (market_agent).
    """
    from app.agents import market_agent
    from app.services import user_store

    db_user = user_store.get_user(user_id) or {}
    target_role = db_user.get("target_role") or "Software Engineer"
    learned_skills = db_user.get("learned_skills") or []
    return market_agent.run(
        user_skills=learned_skills,
        target_role=target_role,
        force_refresh=False,
    )


# ── Agent: Progress / Feedback ─────────────────────────────────────────────────

@app.get("/agent/progress/{user_id}")
def get_progress_summary(user_id: str):
    """Return a unified learning progress snapshot (feedback_agent).

    Includes XP, level, streak, consistency score, skill mastery,
    completed task count, and XP to next level.
    """
    from app.agents import feedback_agent

    return feedback_agent.get_progress_summary(user_id)


# ── Learning Resources ────────────────────────────────────────────────────────

@app.post("/get-resources", response_model=GetResourcesResponse)
def get_learning_resources(payload: GetResourcesRequest) -> GetResourcesResponse:
    """Return curated learning resources for a specific roadmap day topic.

    Uses Bedrock Nova Pro to generate a mix of YouTube search links, official
    docs, free platform links, and practice sites — all targeted to the
    exact topic/skill so they're genuinely useful rather than generic.
    """
    items = resources_engine.get_resources(
        topic=payload.topic,
        skill=payload.skill,
        role=payload.role or "",
    )
    return GetResourcesResponse(
        topic=payload.topic,
        resources=[LearningResource(**r) for r in items["resources"]],
        repos=[GitHubRepo(**r) for r in items["repos"]],
    )


# ── Dynamic Multi-Agent Roadmap ───────────────────────────────────────────────

@app.post("/roadmap/generate")
def generate_dynamic_roadmap(req: GenerateDynamicRoadmapRequest):
    """Kick off async roadmap generation via Lambda self-invocation.

    Returns immediately with {"status": "generating"}.
    Frontend polls GET /roadmap/{user_id} until status becomes "ready".
    """
    import json
    import logging
    import os
    from datetime import datetime, timezone

    import boto3
    from app.services import user_store

    _log = logging.getLogger(__name__)

    # ── 1. Mark as "generating" in DynamoDB ───────────────────────────────────
    started_at = datetime.now(timezone.utc).isoformat()
    user_store.update_user(req.user_id, {
        "dynamic_roadmap": {
            "status": "generating",
            "target_role": req.target_role,
            "started_at": started_at,
        }
    })

    # ── 2. Asynchronously invoke Lambda to run the heavy pipeline ─────────────
    payload = {
        "_internal": "generate_roadmap",
        "user_id": req.user_id,
        "user_skills": req.user_skills or [],
        "target_role": req.target_role,
        "missing_skills": [
            s if isinstance(s, dict) else {"skill": str(s)}
            for s in (req.missing_skills or [])
        ],
        "mastery_levels": req.mastery_levels or {},
        "completed_projects": req.completed_projects or [],
    }
    try:
        region = os.getenv("AWS_REGION", "us-east-1")
        fn_name = os.getenv("AWS_LAMBDA_FUNCTION_NAME", "careeros-api")
        client = boto3.client("lambda", region_name=region)
        client.invoke(
            FunctionName=fn_name,
            InvocationType="Event",   # async — returns immediately
            Payload=json.dumps(payload),
        )
        _log.info("Async roadmap invoke dispatched for user=%s", req.user_id)
    except Exception as exc:
        _log.error("Failed to dispatch async roadmap invoke: %s", exc)
        # Fall through — the "generating" status is already set

    return {"status": "generating", "target_role": req.target_role, "started_at": started_at}


# ── Internal: heavy roadmap generation (called from lambda_handler) ───────────

def _generate_roadmap_internal(event: dict) -> None:
    """Run the full ATLAS→FORGE→QUEST→SAGE pipeline.

    Called by the Lambda handler for async self-invocations.
    Writes the final roadmap (or error) directly to DynamoDB.
    """
    import logging
    from datetime import datetime, timezone
    from app.agents import project_agent, challenge_agent, resource_agent
    from app.services import user_store

    _log = logging.getLogger(__name__)

    user_id = event["user_id"]
    target_role = event.get("target_role", "")
    missing_skills = event.get("missing_skills", [])
    mastery_levels = event.get("mastery_levels", {})

    # ── 1. Hydrate user context from DynamoDB ─────────────────────────────────
    db_user = user_store.get_user(user_id) or {}
    completed_projects: list[str] = db_user.get("completed_projects") or event.get("completed_projects") or []
    mastery: dict[str, int] = mastery_levels or {}

    # ── 2. Normalize + sort + cap skill gaps ─────────────────────────────────
    normalized_gaps: list[dict] = []
    for item in (missing_skills or []):
        if isinstance(item, dict):
            normalized_gaps.append({
                "skill": str(item.get("skill", "Skill")),
                "importance": float(item.get("importance", 0.5) or 0.5),
            })
        else:
            normalized_gaps.append({"skill": str(item), "importance": 0.5})

    sorted_gaps = sorted(normalized_gaps, key=lambda x: x.get("importance", 0), reverse=True)[:5]
    if not sorted_gaps:
        sorted_gaps = [{"skill": "Software Engineering Fundamentals", "importance": 0.9}]

    _MASTERY_TO_DIFFICULTY = ["beginner", "beginner", "intermediate", "intermediate", "advanced"]

    # ── 3. Build each phase sequentially ─────────────────────────────────────
    # Bedrock throttling can make roadmap generation exceed the Lambda timeout.
    # To keep UX reliable, we default to deterministic generation (no LLM calls).
    # You can opt back into LLM enrichment via environment variables.
    import os
    _enrich_all = str(os.getenv("ROADMAP_ENRICH_ALL_PHASES", "")).lower() in {"1", "true", "yes"}
    _enrich_phase1 = str(os.getenv("ROADMAP_ENRICH_PHASE1", "false")).lower() in {"1", "true", "yes"}

    # Import the comprehensive skill-content library
    from app.services.roadmap_content import skill_tasks, skill_project, skill_resources

    def _default_learning_tasks(skill: str, role: str) -> list[str]:
        return skill_tasks(skill, role, mastery.get(skill, 0))

    def _default_project(skill: str, role: str, difficulty: str, seed: str, hours: int) -> RoadmapProject:
        # Derive phase index from seed to pick varied projects per phase
        phase_idx = int(seed.split(":")[-1]) if ":" in seed and seed.split(":")[-1].isdigit() else 0
        proj = skill_project(
            skill=skill,
            role=role,
            difficulty=difficulty,
            phase_idx=phase_idx,
            mastery_level=mastery.get(skill, 0),
            user_id=user_id,
            completed_projects=completed_projects,
        )
        raw_hints = proj.get("hints", {})
        hints = RoadmapProjectHints(
            level_1=raw_hints.get("level_1", ""),
            level_2=raw_hints.get("level_2", ""),
            level_3=raw_hints.get("level_3", ""),
            level_4=raw_hints.get("level_4", ""),
        )
        return RoadmapProject(
            title=proj.get("title", f"{skill} Project"),
            description=proj.get("description", ""),
            objectives=proj.get("objectives", []),
            deliverables=proj.get("deliverables", []),
            evaluation_criteria=proj.get("evaluation_criteria", []),
            hints=hints,
            archetype=proj.get("archetype", "portfolio_project"),
            difficulty=difficulty,
            estimated_hours=proj.get("estimated_hours", hours),
            unique_seed=seed,
        )

    def _default_resources(skill: str, role: str, difficulty: str) -> list[RoadmapResource]:
        """Return skill-specific, direct-link resources from the content library."""
        items = skill_resources(skill, difficulty)
        return [
            RoadmapResource(
                type=r.get("type", "article"),
                title=r.get("title", ""),
                url=r.get("url", ""),
                description=r.get("description", ""),
                mastery_fit=difficulty,
                time_to_consume=r.get("time_to_consume", ""),
            )
            for r in items
        ]

    def _build_phase(idx: int, gap: dict) -> RoadmapPhase:
        skill = gap.get("skill", "Skill")
        importance = float(gap.get("importance", 0.5))
        m_level = min(mastery.get(skill, 0) + idx, 4)
        difficulty = _MASTERY_TO_DIFFICULTY[m_level]

        enrich_with_llm = _enrich_all or (idx == 0 and _enrich_phase1)

        # --- ATLAS: generate week learning plan ---
        if enrich_with_llm:
            try:
                from app.agents import roadmap_agent as _ra
                week = _ra.generate_week_plan(skill, target_role)
                learning_tasks = [d.get("task", "") for d in week if d.get("task")]
            except Exception as exc:
                _log.warning("roadmap_agent week plan failed for %s: %s", skill, exc)
                learning_tasks = _default_learning_tasks(skill, target_role)
        else:
            learning_tasks = _default_learning_tasks(skill, target_role)

        # --- FORGE: generate unique personalized project ---
        project_obj: RoadmapProject | None = None
        if enrich_with_llm:
            project_dict: dict = {}
            try:
                project_dict = project_agent.run(
                    user_id=user_id,
                    skill=skill,
                    target_role=target_role,
                    mastery_level=m_level,
                    completed_projects=completed_projects,
                )
            except Exception as exc:
                _log.warning("project_agent failed for %s: %s", skill, exc)

            if project_dict:
                raw_hints = project_dict.get("hints") or {}
                project_obj = RoadmapProject(
                    title=project_dict.get("title", f"{skill} Project"),
                    description=project_dict.get("description", ""),
                    objectives=project_dict.get("objectives", []),
                    deliverables=project_dict.get("deliverables", []),
                    evaluation_criteria=project_dict.get("evaluation_criteria", []),
                    hints=RoadmapProjectHints(
                        level_1=raw_hints.get("level_1", ""),
                        level_2=raw_hints.get("level_2", ""),
                        level_3=raw_hints.get("level_3", ""),
                        level_4=raw_hints.get("level_4", ""),
                    ),
                    archetype=project_dict.get("archetype", ""),
                    difficulty=project_dict.get("difficulty", difficulty),
                    estimated_hours=project_dict.get("estimated_hours", 8),
                    unique_seed=project_dict.get("unique_seed", ""),
                )
            else:
                project_obj = _default_project(
                    skill=skill,
                    role=target_role,
                    difficulty=difficulty,
                    seed=f"template:{skill}:{target_role}:{idx}",
                    hours=8 + idx * 2,
                )
        else:
            project_obj = _default_project(
                skill=skill,
                role=target_role,
                difficulty=difficulty,
                seed=f"template:{skill}:{target_role}:{idx}",
                hours=8 + idx * 2,
            )

        # --- QUEST: daily challenge for phase 1 only ---
        challenge_obj: RoadmapChallenge | None = None
        if idx == 0:
            try:
                ch = challenge_agent.generate(
                    user_id=user_id,
                    skill=skill,
                    mastery_level=mastery.get(skill, 0),
                )
                challenge_obj = RoadmapChallenge(
                    challenge_id=ch.get("challenge_id", ""),
                    skill=ch.get("skill", skill),
                    type=ch.get("type", "conceptual"),
                    difficulty=ch.get("difficulty", "beginner"),
                    question=ch.get("question", ""),
                    context_code=ch.get("context_code"),
                    expected_concepts=ch.get("expected_concepts", []),
                    xp_available=ch.get("xp_available", 5),
                    today=ch.get("today", ""),
                )
            except Exception as exc:
                _log.warning("challenge_agent failed for %s: %s", skill, exc)

        # --- SAGE: exact learning resources ---
        resources_list: list[RoadmapResource] = []
        if enrich_with_llm:
            try:
                raw_resources = resource_agent.run(
                    skill=skill,
                    target_role=target_role,
                    mastery_level=m_level,
                    max_resources=5,
                )
                resources_list = [
                    RoadmapResource(
                        type=r.get("type", "article"),
                        title=r.get("title", ""),
                        url=r.get("url", ""),
                        description=r.get("description", ""),
                        mastery_fit=r.get("mastery_fit", ""),
                        time_to_consume=r.get("time_to_consume", ""),
                    )
                    for r in raw_resources
                ]
            except Exception as exc:
                _log.warning("resource_agent failed for %s: %s", skill, exc)
                resources_list = _default_resources(skill, target_role, difficulty)
        else:
            resources_list = _default_resources(skill, target_role, difficulty)

        return RoadmapPhase(
            phase=idx + 1,
            focus_skill=skill,
            difficulty=difficulty,
            importance=round(importance, 3),
            learning_tasks=learning_tasks,
            project=project_obj,
            daily_challenge=challenge_obj,
            resources=resources_list,
        )

    phases: list[RoadmapPhase] = []
    for i, gap in enumerate(sorted_gaps):
        try:
            phase = _build_phase(i, gap)
            phases.append(phase)
        except Exception as exc:
            _log.error("Phase %d failed: %s", i, exc)

    # ── 4. Persist completed roadmap to DynamoDB ──────────────────────────────
    generated_at = datetime.now(timezone.utc).isoformat()
    user_store.update_user(user_id, {
        "dynamic_roadmap": {
            "status": "ready",
            "target_role": target_role,
            "phases": [p.model_dump() for p in phases],
            "total_phases": len(phases),
            "generated_at": generated_at,
        }
    })
    _log.info("Roadmap persisted for user=%s — %d phases", user_id, len(phases))


@app.get("/roadmap/{user_id}")
def get_persisted_roadmap(user_id: str):
    """Return the last generated dynamic roadmap for a user (from DynamoDB).

    Returns status field: "generating" | "ready" | "failed"
    Frontend polls this until status is "ready".
    """
    from datetime import datetime, timezone
    from fastapi import HTTPException
    from app.services import user_store
    db_user = user_store.get_user(user_id) or {}
    roadmap = db_user.get("dynamic_roadmap")
    if not roadmap:
        raise HTTPException(status_code=404, detail="No roadmap found")
    # Ensure status field is always present for backward-compat
    if "status" not in roadmap:
        roadmap["status"] = "ready" if roadmap.get("phases") else "unknown"

    # Safety: if a background generation timed out/crashed, don't leave the UI
    # polling forever.
    if roadmap.get("status") == "generating" and roadmap.get("started_at"):
        try:
            started_at = datetime.fromisoformat(str(roadmap["started_at"]).replace("Z", "+00:00"))
            age_s = (datetime.now(timezone.utc) - started_at).total_seconds()
            if age_s > 6 * 60:
                roadmap["status"] = "failed"
                roadmap["error"] = "Roadmap generation timed out. Please click Regenerate Roadmap."
                user_store.update_user(user_id, {"dynamic_roadmap": roadmap})
        except Exception:
            pass
    return roadmap


@app.post("/roadmap/{user_id}/phase/{phase_idx}/submit")
def submit_phase_project(user_id: str, phase_idx: int, payload: SubmitPhaseRequest):
    """Evaluate a project submission for a roadmap phase.

    Expects JSON body: {"github_repo_url": "https://github.com/..."}
    Runs REVIEW agent → awards XP → marks phase completed in DynamoDB.
    Returns evaluation result + updated XP.
    """
    import logging
    from fastapi import HTTPException
    from app.agents import evaluation_agent
    from app.services import user_store

    _log = logging.getLogger(__name__)

    github_repo_url = payload.github_repo_url.strip()
    if not github_repo_url:
        raise HTTPException(status_code=400, detail="github_repo_url is required")

    # Load the stored roadmap to get the project spec for this phase
    db_user = user_store.get_user(user_id) or {}
    roadmap = db_user.get("dynamic_roadmap") or {}
    phases = roadmap.get("phases", [])

    if phase_idx < 0 or phase_idx >= len(phases):
        raise HTTPException(status_code=404, detail=f"Phase {phase_idx} not found")

    phase = phases[phase_idx]
    project = phase.get("project") or {}
    skill = phase.get("focus_skill", "")

    # Run evaluation agent (REVIEW)
    result = evaluation_agent.run(
        user_id=user_id,
        github_repo_url=github_repo_url,
        project=project,
        skill=skill,
    )

    # Mark phase as completed in DynamoDB regardless of pass/fail
    # (so the user can see feedback either way; only XP gated on pass)
    roadmap_complete = False
    newly_learned_skills: list[str] = []
    bonus_xp = 0
    try:
        phases[phase_idx]["completed"] = True
        phases[phase_idx]["submission_url"] = github_repo_url
        phases[phase_idx]["evaluation"] = {
            "score": result.get("score", 0),
            "passed": result.get("passed", False),
            "xp_awarded": result.get("xp_awarded", 0),
            "feedback": result.get("feedback", ""),
        }
        # Append to completed_projects list so FORGE won't repeat it
        completed_projects: list = db_user.get("completed_projects") or []
        project_title = project.get("title", skill)
        if project_title not in completed_projects:
            completed_projects.append(project_title)

        # Add this phase's skill to learned_skills
        learned_skills: list = db_user.get("learned_skills") or []
        if skill and skill not in learned_skills:
            learned_skills.append(skill)
            newly_learned_skills.append(skill)

        # Check if ALL phases are now complete → roadmap completion bonus
        total_phases = len(phases)
        completed_count = sum(1 for p in phases if p.get("completed"))
        if completed_count >= total_phases:
            roadmap_complete = True
            # Award all phase skills as learned
            for p in phases:
                fs = p.get("focus_skill", "")
                if fs and fs not in learned_skills:
                    learned_skills.append(fs)
                    newly_learned_skills.append(fs)
            # Bonus XP: 500 for completing the full roadmap
            bonus_xp = 500

        user_store.update_user(user_id, {
            "dynamic_roadmap": {**roadmap, "phases": phases},
            "completed_projects": completed_projects,
            "learned_skills": learned_skills,
        })
    except Exception as exc:
        _log.warning("submit_phase_project: failed to persist completion: %s", exc)

    # ── Update XP/level metrics (file-based game engine) ────────────────────
    try:
        from app.services.utils import update_metrics_on_task_submission
        xp_quality = max(10, min(100, result.get("score", 50)))
        update_metrics_on_task_submission(user_id, quality_score=xp_quality)
        if bonus_xp:
            # Award roadmap completion bonus as two max-quality submissions
            update_metrics_on_task_submission(user_id, quality_score=100)
            update_metrics_on_task_submission(user_id, quality_score=100)
    except Exception as exc:
        _log.warning("submit_phase_project: xp update failed: %s", exc)

    return {
        **result,
        "phase_idx": phase_idx,
        "skill": skill,
        "phase_marked_complete": True,
        "roadmap_complete": roadmap_complete,
        "newly_learned_skills": newly_learned_skills,
        "bonus_xp": bonus_xp,
    }

