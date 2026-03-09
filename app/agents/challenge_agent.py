"""
Adaptive Daily Challenge Agent  — v2  ("Eat the Frog" Quest Engine)
====================================================================
Responsibility
--------------
  Generate and evaluate personalised daily micro-challenges that:
    • Reinforce skills the user ALREADY HAS   (mastery deepening)
    • Close gaps in skills the user IS MISSING (gap reduction)

  Agent topology (read-only queries, no circular writes):
    SCOUT  → profile_agent   — user skill extraction from resume / GitHub
    DELTA  → gap_agent data  — ranked skill-gap list from user state
    ATLAS  → roadmap stage   — current learning phase from user state
    SAGE   → challenge history + feedback — past performance patterns

  Challenge types
  ---------------
    quiz              — multiple-choice concept question
    code_completion   — complete a missing code snippet
    debugging         — find and fix a bug in provided code
    micro_impl        — write a small function / module from scratch
    concept_explain   — plain-English explanation + real-world analogy

  Mastery update formula (applied after every evaluation)
  -------------------------------------------------------
    new_mastery_score = (prev_mastery_score * 0.7) + (challenge_score/100 * 4 * 0.3)
    clamped to [0, 4] and stored back as mastery_level for that skill.

    gap_severity adjustment:
      score ≥ 70  → gap_severity  *= 0.85   (gap shrinking)
      score <  70  → gap_severity  *= 1.05   (gap widening)

All LLM calls are funnelled through ask_llm().
"""
from __future__ import annotations

import hashlib
import json
import logging
import random
from datetime import date, datetime, timezone
from typing import Any

from app.services.llm_service import ask_llm
from app.services import user_store, mastery_tracker

logger = logging.getLogger(__name__)

# ── Challenge type catalogue ──────────────────────────────────────────────────
CHALLENGE_TYPES = [
    "quiz",
    "code_completion",
    "debugging",
    "micro_impl",
    "concept_explain",
]

# Mastery level (0-4) → preferred challenge types (ascending complexity)
_TYPE_BY_MASTERY: dict[int, list[str]] = {
    0: ["quiz", "concept_explain"],
    1: ["quiz", "code_completion", "concept_explain"],
    2: ["code_completion", "debugging", "concept_explain"],
    3: ["debugging", "micro_impl", "code_completion"],
    4: ["micro_impl", "debugging", "code_completion"],
}

# XP awarded on pass / partial-pass (fail = xp // 4)
_XP_MAP: dict[int, int] = {0: 5, 1: 8, 2: 12, 3: 16, 4: 20}

# Friendly labels for the frontend
_DIFFICULTY_LABEL: dict[int, str] = {
    0: "beginner",
    1: "beginner",
    2: "intermediate",
    3: "intermediate",
    4: "advanced",
}

# Ratio: how often to target a GAP skill vs a KNOWN skill
_GAP_SKILL_RATIO = 0.65    # 65 % target gap skills, 35 % reinforce known



# ── Utility helpers ───────────────────────────────────────────────────────────

def _challenge_id(user_id: str, skill: str, today: str, salt: str = "") -> str:
    return hashlib.sha256(
        f"{user_id}:{skill}:{today}:{salt}".encode()
    ).hexdigest()[:16]


def _pick_challenge_type(mastery_level: int, past_challenges: list[dict]) -> str:
    """Choose a challenge type based on mastery; avoid repeating the last type."""
    options = _TYPE_BY_MASTERY.get(mastery_level, ["quiz"])
    last_type = (past_challenges[-1].get("challenge_type") if past_challenges else None)
    filtered = [t for t in options if t != last_type] or options
    return random.choice(filtered)


def _select_target_skill(
    db_user: dict,
    force_gap: bool = False,
) -> tuple[str, bool]:
    """Return (skill, is_gap_skill).

    Logic:
      • If random draw < _GAP_SKILL_RATIO (or force_gap) → pick top gap skill.
      • Otherwise → pick a random skill the user already has.
      • Falls back to next_priority_skill if nothing else is available.
    """
    gap_skills: list[str] = []
    for g in (db_user.get("skill_gaps") or []):
        if isinstance(g, dict):
            gap_skills.append(g.get("skill", ""))
        elif isinstance(g, str):
            gap_skills.append(g)
    gap_skills = [s for s in gap_skills if s]

    known_skills: list[str] = list(db_user.get("skills") or [])

    use_gap = force_gap or (random.random() < _GAP_SKILL_RATIO)

    if use_gap and gap_skills:
        return gap_skills[0], True
    if known_skills:
        return random.choice(known_skills), False
    # Nothing available — fall back to next_priority_skill
    return (db_user.get("next_priority_skill") or "Python"), True


def _build_user_context_block(db_user: dict, skill: str, is_gap: bool) -> str:
    """Construct the personalised CONTEXT block injected into the LLM prompt."""
    lines: list[str] = ["=== USER CONTEXT ==="]

    # SCOUT signal: extracted skills
    known = list(db_user.get("skills") or [])
    if known:
        lines.append(f"Known skills: {', '.join(known[:20])}")

    # DELTA signal: gap list
    gaps = db_user.get("skill_gaps") or []
    if gaps:
        gap_names = [g["skill"] if isinstance(g, dict) else g for g in gaps[:5]]
        lines.append(f"Top skill gaps: {', '.join(gap_names)}")

    # Skill-specific mastery score
    skill_mastery_map: dict = db_user.get("skill_mastery") or {}
    skill_score = skill_mastery_map.get(skill.lower(), db_user.get("mastery_level", 0))
    lines.append(f"Mastery score for '{skill}': {skill_score}/4")
    lines.append(f"Targeting gap skill: {is_gap}")

    # ATLAS signal: roadmap phase
    roadmap = db_user.get("dynamic_roadmap") or {}
    phases = roadmap.get("phases") or []
    if phases:
        current_phase = next(
            (p for p in phases if not p.get("completed", False)), phases[-1]
        )
        phase_title = current_phase.get("title") or current_phase.get("phase_title", "")
        if phase_title:
            lines.append(f"Current roadmap phase: {phase_title}")

    # SAGE signal: recent challenge history
    history: list[dict] = db_user.get("challenge_history") or []
    if history:
        recent = history[-3:]
        perf_parts = []
        for h in recent:
            s = h.get("score", "?")
            ct = h.get("challenge_type", "?")
            sk = h.get("skill", "?")
            perf_parts.append(f"{sk}/{ct}→{s}%")
        lines.append(f"Recent challenge performance: {'; '.join(perf_parts)}")

        # Extract common mistakes from history
        mistakes = [m for h in recent for m in (h.get("mistakes") or [])]
        if mistakes:
            lines.append(f"Recent mistakes to address: {'; '.join(mistakes[:4])}")

    # Resume/GitHub context
    resume_summary = db_user.get("resume_summary") or ""
    if resume_summary:
        lines.append(f"Resume summary: {resume_summary[:300]}")

    github_langs = db_user.get("github_primary_languages") or []
    if github_langs:
        lines.append(f"GitHub primary languages: {', '.join(github_langs[:5])}")

    lines.append("=== END CONTEXT ===")
    return "\n".join(lines)


# ── Type-specific prompt builders ─────────────────────────────────────────────

def _build_generation_prompt(
    skill: str,
    challenge_type: str,
    mastery_level: int,
    user_context: str,
    today: str,
) -> str:
    type_instructions = {
        "quiz": (
            "Generate a multiple-choice quiz question with exactly 4 options (A/B/C/D). "
            "Exactly one option must be correct. Test deep conceptual understanding, not syntax recall. "
            "Return 'context_code': null."
        ),
        "code_completion": (
            "Provide a short code snippet (10-25 lines) with ONE clearly marked "
            "missing section replaced by `# TODO: implement here`. "
            "The missing section must demonstrate a real pattern or algorithm. "
            "Place the snippet in 'context_code'."
        ),
        "debugging": (
            "Write a plausible code snippet (10-20 lines) that contains exactly ONE subtle bug. "
            "Do NOT hint where the bug is. "
            "The bug must be non-trivial (race condition, off-by-one, wrong algorithm, etc.). "
            "Place the buggy code in 'context_code'."
        ),
        "micro_impl": (
            "Ask the user to implement a small but realistic function, class, or script "
            "(5-15 minutes of work). Describe the expected behaviour clearly. "
            "Include input/output examples in the prompt. "
            "Return 'context_code': null unless a starter scaffold is helpful."
        ),
        "concept_explain": (
            "Ask the user to explain the concept in plain English as if teaching a junior developer. "
            "Include a request for one real-world analogy and one production use-case. "
            "Return 'context_code': null."
        ),
    }

    return (
        "You are a senior AI coding mentor generating a personalised daily challenge.\n\n"
        f"{user_context}\n\n"
        f"Skill to challenge: {skill}\n"
        f"Challenge type: {challenge_type}\n"
        f"Student mastery level: {mastery_level}/4\n"
        f"Today's date: {today}\n\n"
        f"INSTRUCTIONS FOR THIS TYPE:\n{type_instructions.get(challenge_type, '')}\n\n"
        "REQUIREMENTS:\n"
        "• Challenge must be unique — shaped by the user context above.\n"
        "• Must take 5-15 minutes to complete.\n"
        "• Must be directly relevant to the skill listed.\n"
        "• If mastery_level ≤ 1: foundational concept; ≥ 3: production-complexity.\n"
        "• Include 3 progressive hints the user can unlock.\n"
        "• List 2-4 expected_concepts the ideal answer must address.\n"
        "• List the expected_answer_format clearly.\n\n"
        "Return ONLY valid JSON — no markdown fences:\n"
        "{\n"
        '  "challenge_prompt": "str",\n'
        '  "context_code": "str or null",\n'
        '  "hints": ["hint1", "hint2", "hint3"],\n'
        '  "expected_concepts": ["str", ...],\n'
        '  "expected_answer_format": "str",\n'
        '  "options": {"A": "str", "B": "str", "C": "str", "D": "str"} or null,\n'
        '  "correct_option": "A|B|C|D or null"\n'
        "}"
    )


def _build_evaluation_prompt(
    skill: str,
    challenge_type: str,
    challenge_prompt: str,
    context_code: str | None,
    expected_concepts: list[str],
    answer_text: str,
    options: dict | None,
    correct_option: str | None,
) -> str:
    prompt = (
        "You are a strict but encouraging coding mentor evaluating a daily challenge response.\n\n"
        f"Skill: {skill}\n"
        f"Challenge type: {challenge_type}\n"
        f"Challenge prompt:\n{challenge_prompt}\n"
    )
    if context_code:
        prompt += f"\nContext code:\n{context_code}\n"
    if options and correct_option:
        formatted_opts = "\n".join(f"  {k}: {v}" for k, v in options.items())
        prompt += f"\nOptions:\n{formatted_opts}\nCorrect option: {correct_option}\n"
    prompt += (
        f"\nExpected key concepts: {', '.join(expected_concepts)}\n"
        f"\nStudent's answer:\n{answer_text}\n\n"
        "Evaluate the answer on:\n"
        "  1. Correctness (40 pts)\n"
        "  2. Reasoning quality / explanation clarity (30 pts)\n"
        "  3. Code quality / best practices if applicable (20 pts)\n"
        "  4. Completeness (10 pts)\n\n"
        "Also identify up to 3 specific mistakes the student made.\n\n"
        "Return ONLY valid JSON:\n"
        "{\n"
        '  "score": 0,\n'
        '  "passed": false,\n'
        '  "feedback": "2-4 sentence personalised feedback",\n'
        '  "correct_answer": "ideal answer or explanation",\n'
        '  "mistakes": ["mistake1", ...],\n'
        '  "strengths": ["strength1", ...]\n'
        "}"
    )
    return prompt


# ── Public API ─────────────────────────────────────────────────────────────────

def generate(
    user_id: str,
    skill: str | None = None,
    mastery_level: int = 0,
    force_gap: bool = False,
    db_user: dict | None = None,
) -> dict:
    """Generate a personalised daily challenge.

    Args:
        user_id:       User identifier.
        skill:         Override skill to target (optional — auto-selected if None).
        mastery_level: Current mastery 0–4 (overridden by per-skill mastery if available).
        force_gap:     If True, always target a gap skill.
        db_user:       Pre-fetched user dict (avoids a second DynamoDB read).

    Returns:
        {
            "challenge_id":          str,
            "challenge_type":        str,
            "skill_targeted":        str,
            "is_gap_skill":          bool,
            "difficulty_level":      str,
            "challenge_prompt":      str,
            "context_code":          str | None,
            "hints":                 [str, str, str],
            "expected_concepts":     [str, ...],
            "expected_answer_format":str,
            "options":               dict | None,   # quiz only
            "correct_option":        str | None,    # quiz only (hidden from client)
            "xp_available":          int,
            "today":                 str,
            "mastery_level":         int,
        }
    """
    today = date.today().isoformat()

    # ── SCOUT: load full user state ──────────────────────────────────────────
    if db_user is None:
        db_user = user_store.get_user(user_id) or {}

    # ── Skill selection ──────────────────────────────────────────────────────
    if skill:
        is_gap = skill.lower() not in [
            s.lower() for s in (db_user.get("skills") or [])
        ]
    else:
        skill, is_gap = _select_target_skill(db_user, force_gap=force_gap)

    # Per-skill mastery overrides the global mastery_level
    skill_mastery_map: dict = db_user.get("skill_mastery") or {}
    effective_mastery = int(skill_mastery_map.get(skill.lower(), mastery_level))
    effective_mastery = max(0, min(4, effective_mastery))

    # ── Challenge type selection (SAGE: avoid repeating) ────────────────────
    past_challenges: list[dict] = db_user.get("challenge_history") or []
    challenge_type = _pick_challenge_type(effective_mastery, past_challenges)

    # ── ATLAS: user context block ────────────────────────────────────────────
    user_context = _build_user_context_block(db_user, skill, is_gap)

    # ── LLM generation ───────────────────────────────────────────────────────
    prompt = _build_generation_prompt(
        skill=skill,
        challenge_type=challenge_type,
        mastery_level=effective_mastery,
        user_context=user_context,
        today=today,
    )

    try:
        raw = ask_llm(prompt)
        raw = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        llm_data = json.loads(raw)
    except Exception as exc:
        logger.error("challenge_agent.generate LLM error for %s/%s: %s", user_id, skill, exc)
        llm_data = _fallback_challenge(skill, challenge_type, effective_mastery)

    cid = _challenge_id(user_id, skill, today, challenge_type)

    result = {
        "challenge_id":           cid,
        "challenge_type":         challenge_type,
        "skill_targeted":         skill,
        "is_gap_skill":           is_gap,
        "difficulty_level":       _DIFFICULTY_LABEL.get(effective_mastery, "beginner"),
        "challenge_prompt":       llm_data.get("challenge_prompt", llm_data.get("question", "")),
        "context_code":           llm_data.get("context_code"),
        "hints":                  llm_data.get("hints") or _default_hints(skill, challenge_type),
        "expected_concepts":      llm_data.get("expected_concepts", []),
        "expected_answer_format": llm_data.get("expected_answer_format", "Free text or code"),
        "options":                llm_data.get("options"),         # quiz only
        "correct_option":         llm_data.get("correct_option"),  # hidden from client
        "xp_available":           _XP_MAP.get(effective_mastery, 5),
        "today":                  today,
        "mastery_level":          effective_mastery,
    }

    logger.info(
        "challenge_agent.generate: user=%s skill=%s type=%s difficulty=%s gap=%s",
        user_id, skill, challenge_type, result["difficulty_level"], is_gap,
    )
    return result


def evaluate(
    user_id: str,
    challenge: dict,
    answer_text: str,
    db_user: dict | None = None,
) -> dict:
    """Evaluate the user's challenge response and update mastery + skill gap.

    Mastery update formula:
        new_mastery = (prev_mastery * 0.7) + (score/100 * 4 * 0.3)
    Gap severity update:
        score ≥ 70 → gap_severity *= 0.85   (gap shrinks)
        score <  70 → gap_severity *= 1.05  (gap widens)

    Returns:
        {
            "passed":          bool,
            "score":           int (0–100),
            "xp_earned":       int,
            "streak":          int,
            "feedback":        str,
            "correct_answer":  str,
            "mistakes":        [str],
            "strengths":       [str],
            "mastery_before":  int,
            "mastery_after":   int,
            "next_difficulty": int,
            "gap_updated":     bool,
        }
    """
    skill = challenge.get("skill_targeted") or challenge.get("skill", "Unknown")
    challenge_type = challenge.get("challenge_type") or challenge.get("type", "quiz")
    expected = challenge.get("expected_concepts", [])
    challenge_prompt = challenge.get("challenge_prompt") or challenge.get("question", "")
    context_code = challenge.get("context_code")
    options = challenge.get("options")
    correct_option = challenge.get("correct_option")
    xp_available = challenge.get("xp_available", 5)

    # ── LLM evaluation ───────────────────────────────────────────────────────
    eval_prompt = _build_evaluation_prompt(
        skill=skill,
        challenge_type=challenge_type,
        challenge_prompt=challenge_prompt,
        context_code=context_code,
        expected_concepts=expected,
        answer_text=answer_text,
        options=options,
        correct_option=correct_option,
    )

    try:
        raw = ask_llm(eval_prompt)
        raw = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        eval_data = json.loads(raw)
    except Exception as exc:
        logger.error("challenge_agent.evaluate LLM error for %s: %s", user_id, exc)
        eval_data = {
            "score": 0, "passed": False,
            "feedback": "Evaluation failed — please try again.",
            "correct_answer": "", "mistakes": [], "strengths": [],
        }

    passed: bool = bool(eval_data.get("passed", False))
    score: int = int(eval_data.get("score", 0))
    xp_earned = xp_available if passed else max(1, xp_available // 4)
    mistakes: list[str] = eval_data.get("mistakes") or []
    strengths: list[str] = eval_data.get("strengths") or []

    # ── Persist state ────────────────────────────────────────────────────────
    streak = 0
    mastery_before = challenge.get("mastery_level", 0)
    mastery_after = mastery_before
    gap_updated = False

    try:
        if db_user is None:
            db_user = user_store.get_user(user_id) or {}

        current_xp: int = db_user.get("xp", 0) or 0
        streak: int = db_user.get("challenge_streak", 0) or 0

        # ── Mastery update: new_mastery = prev*0.7 + (score/100*4)*0.3 ──────
        skill_mastery_map: dict = dict(db_user.get("skill_mastery") or {})
        mastery_before = int(skill_mastery_map.get(skill.lower(), mastery_before))
        raw_new = (mastery_before * 0.7) + ((score / 100.0) * 4.0 * 0.3)
        mastery_after = max(0, min(4, round(raw_new)))
        skill_mastery_map[skill.lower()] = mastery_after

        # ── Streak ────────────────────────────────────────────────────────────
        if passed:
            streak += 1
        else:
            streak = 0

        # Global mastery_level = avg of all individual skill mastery scores
        global_mastery = (
            round(sum(skill_mastery_map.values()) / len(skill_mastery_map))
            if skill_mastery_map else mastery_after
        )

        # ── Gap severity update ───────────────────────────────────────────────
        gaps: list[dict] = list(db_user.get("skill_gaps") or [])
        for g in gaps:
            if isinstance(g, dict) and g.get("skill", "").lower() == skill.lower():
                severity = float(g.get("severity", g.get("importance", 50)))
                if score >= 70:
                    g["severity"] = round(severity * 0.85, 1)
                else:
                    g["severity"] = round(min(100, severity * 1.05), 1)
                gap_updated = True
                break

        # ── Challenge history (SAGE: keep last 20 entries) ───────────────────
        history: list[dict] = list(db_user.get("challenge_history") or [])
        history.append({
            "date":           date.today().isoformat(),
            "challenge_id":   challenge.get("challenge_id", ""),
            "challenge_type": challenge_type,
            "skill":          skill,
            "score":          score,
            "passed":         passed,
            "mistakes":       mistakes[:3],
        })
        history = history[-20:]  # keep last 20

        # ── Persist to DynamoDB ───────────────────────────────────────────────
        update_payload: dict = {
            "xp":               current_xp + xp_earned,
            "challenge_streak": streak,
            "mastery_level":    global_mastery,
            "skill_mastery":    skill_mastery_map,
            "challenge_history": history,
        }
        if gap_updated:
            update_payload["skill_gaps"] = gaps

        user_store.update_user(user_id, update_payload)
        logger.info(
            "challenge_agent.evaluate: user=%s skill=%s score=%d mastery %d→%d streak=%d",
            user_id, skill, score, mastery_before, mastery_after, streak,
        )

    except Exception as exc:
        logger.warning("challenge_agent.evaluate persist failed for %s: %s", user_id, exc)

    return {
        "passed":          passed,
        "score":           score,
        "xp_earned":       xp_earned,
        "streak":          streak,
        "feedback":        eval_data.get("feedback", ""),
        "correct_answer":  eval_data.get("correct_answer", ""),
        "mistakes":        mistakes,
        "strengths":       strengths,
        "mastery_before":  mastery_before,
        "mastery_after":   mastery_after,
        "next_difficulty": mastery_after,
        "gap_updated":     gap_updated,
    }


# ── Fallback helpers ───────────────────────────────────────────────────────────

def _fallback_challenge(skill: str, challenge_type: str, mastery_level: int) -> dict:
    fallbacks = {
        "quiz": {
            "challenge_prompt": (
                f"Which of the following best describes a core use-case of {skill}?\n"
                "A) It is primarily used for styling web pages.\n"
                "B) It enables building scalable backend services.\n"
                "C) It is a database engine.\n"
                "D) It is only relevant in mobile development."
            ),
            "context_code": None,
            "hints": [
                f"Think about what problem {skill} was created to solve.",
                "Consider which industry uses it most.",
                "Look at the official documentation's opening paragraph.",
            ],
            "expected_concepts": [f"Core purpose of {skill}", "primary use cases"],
            "expected_answer_format": "Select A, B, C, or D",
            "options": {
                "A": "Used for styling web pages.",
                "B": "Enables building scalable backend services.",
                "C": "A database engine.",
                "D": "Only relevant in mobile development.",
            },
            "correct_option": "B",
        },
        "concept_explain": {
            "challenge_prompt": (
                f"Explain {skill} as if you were teaching a junior developer. "
                "Include a real-world analogy and one production use-case."
            ),
            "context_code": None,
            "hints": [
                f"Start with what problem {skill} solves.",
                "Use an everyday analogy (e.g. a library, a post office, a recipe).",
                "Mention a specific company or product that relies on it.",
            ],
            "expected_concepts": [f"definition of {skill}", "analogy", "production use-case"],
            "expected_answer_format": "2-3 paragraphs of plain English",
            "options": None,
            "correct_option": None,
        },
        "debugging": {
            "challenge_prompt": f"Find and fix the bug in the {skill} code snippet below.",
            "context_code": f"# TODO: fallback — add a real {skill} buggy snippet here\npass",
            "hints": [
                "Read each line carefully for off-by-one errors.",
                "Check boundary conditions.",
                "Consider edge cases like empty input.",
            ],
            "expected_concepts": ["bug identification", "corrected logic"],
            "expected_answer_format": "Fixed code with a brief explanation",
            "options": None,
            "correct_option": None,
        },
        "code_completion": {
            "challenge_prompt": f"Complete the missing implementation in the {skill} snippet below.",
            "context_code": f"# TODO: implement this {skill} function\ndef solution():\n    pass",
            "hints": [
                f"Review the {skill} documentation for the relevant API.",
                "Think about the expected input and output.",
                "Start with the simplest working version.",
            ],
            "expected_concepts": ["correct implementation", "appropriate API usage"],
            "expected_answer_format": "Completed code block",
            "options": None,
            "correct_option": None,
        },
        "micro_impl": {
            "challenge_prompt": (
                f"Write a small, working {skill} function that solves a realistic problem. "
                "Include docstring and at least one usage example."
            ),
            "context_code": None,
            "hints": [
                "Break the problem into smaller sub-steps.",
                f"Use idiomatic {skill} patterns.",
                "Handle at least one error case.",
            ],
            "expected_concepts": ["correct logic", "idiomatic code", "error handling"],
            "expected_answer_format": "Working code with comments",
            "options": None,
            "correct_option": None,
        },
    }
    return fallbacks.get(challenge_type, fallbacks["concept_explain"])


def _default_hints(skill: str, challenge_type: str) -> list[str]:
    return [
        f"Review the official {skill} documentation.",
        "Break the problem into smaller steps before writing any code.",
        "Consider edge cases and error handling.",
    ]
