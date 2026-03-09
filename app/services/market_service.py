"""
Live Market Intelligence Service
=================================
Pulls real job listing data from free public APIs to refresh the skill demand
frequencies in market_skills.json.

Data sources (no API key required)
------------------------------------
RemoteOK  — https://remoteok.io/api (returns up to 300 tech jobs with tags)
Adzuna    — https://api.adzuna.com   (requires free API key, env: ADZUNA_APP_ID,
                                      ADZUNA_APP_KEY; gracefully skipped if absent)

How it works
------------
1. Fetch job listings for common tech roles.
2. For each job, extract skill/tag signals.
3. Count how often each skill appears per role category.
4. Normalise counts to 0–1 frequency values.
5. Merge with the existing static market_skills.json using a weighted blend
   (80% live data, 20% static baseline) so one bad fetch can't corrupt data.
6. Write the updated data back to market_skills.json.

Run either:
    python -m app.services.market_service          (one-shot refresh)
    POST /market/refresh                            (via API)
    scripts/refresh_market_data.py                 (scheduled cron)
"""
from __future__ import annotations

import json
import logging
import os
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import boto3
import requests
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

# Static bundled file (read-only on Lambda) — used as fallback only
_DATA_PATH = Path(__file__).parent.parent / "data" / "market_skills.json"

# Writable path on Lambda; persisted to S3 so it survives cold starts
_TMP_PATH   = Path("/tmp/market_skills.json")
_S3_BUCKET  = os.getenv("CAREEROS_RESUME_BUCKET", "careeros-resumes-985090322407")
_S3_KEY     = "config/market_skills.json"
_REGION     = os.getenv("AWS_REGION", "us-east-1")

_s3_client = None


def _s3():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=_REGION)
    return _s3_client


def _download_from_s3() -> bool:
    """Download refreshed market data from S3 to /tmp. Returns True on success."""
    try:
        _s3().download_file(_S3_BUCKET, _S3_KEY, str(_TMP_PATH))
        logger.info("Loaded market_skills.json from S3")
        return True
    except ClientError as exc:
        if exc.response["Error"]["Code"] not in ("NoSuchKey", "404"):
            logger.warning("S3 download failed: %s", exc)
        return False


def get_market_data() -> dict:
    """Load market skill data: /tmp (hot cache) → S3 → bundled static file."""
    if _TMP_PATH.exists():
        with open(_TMP_PATH) as fh:
            return json.load(fh)
    if _download_from_s3() and _TMP_PATH.exists():
        with open(_TMP_PATH) as fh:
            return json.load(fh)
    with open(_DATA_PATH) as fh:
        return json.load(fh)


# ── Adzuna credentials (optional) ─────────────────────────────────────────────
_ADZUNA_APP_ID  = os.getenv("ADZUNA_APP_ID", "")
_ADZUNA_APP_KEY = os.getenv("ADZUNA_APP_KEY", "")

# ── RapidAPI / JSearch credentials (optional) ─────────────────────────────────
# JSearch aggregates Indeed, LinkedIn Jobs, and Glassdoor.
# Free tier: 200 req/month — https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
# NOTE: loaded dynamically at call time so Lambda env-var updates take effect
# without requiring a cold start.
def _get_rapidapi_key() -> str:
    return os.getenv("RAPIDAPI_KEY", "")

# ── Role detection keywords ────────────────────────────────────────────────────
# Maps job title keywords → canonical role name (must match market_skills.json keys)
_ROLE_PATTERNS: list[tuple[list[str], str]] = [
    (["frontend", "front-end", "front end", "ui developer", "ui engineer",
      "react developer", "react engineer", "angular developer", "vue developer",
      "web developer", "web engineer", "javascript developer", "javascript engineer",
      "typescript developer", "typescript engineer", "ui/ux developer"],       "Frontend Developer"),
    (["backend", "back-end", "back end", "server-side", "api developer",
      "api engineer", "python developer", "python engineer", "java developer",
      "java engineer", "golang", "go developer", "ruby developer", "rails developer",
      "php developer", "node developer", "node engineer", "django", "flask",
      "spring boot", "rest api", "microservices engineer"],                    "Backend Developer"),
    (["fullstack", "full-stack", "full stack", "software engineer",
      "software developer", "application developer", "application engineer",
      "generalist engineer", "web application developer"],                     "Full Stack Developer"),
    (["data scientist", "ml engineer", "machine learning", "ai engineer",
      "artificial intelligence", "deep learning", "nlp engineer", "llm engineer",
      "research engineer", "computer vision", "model engineer", "ai developer"],  "Data Scientist"),
    (["data analyst", "analytics engineer", "bi developer",
      "business intelligence", "business analyst", "data engineer",
      "etl developer", "reporting analyst", "insights analyst"],               "Data Analyst"),
    (["devops", "sre", "site reliability", "platform engineer",
      "infrastructure engineer", "infra engineer", "release engineer",
      "build engineer", "cloud operations", "devsecops",
      "systems engineer", "systems administrator"],                            "DevOps Engineer"),
    (["cloud engineer", "aws engineer", "azure engineer", "gcp engineer",
      "solutions architect", "solutions arch", "cloud architect",
      "cloud developer", "cloud consultant", "infrastructure architect"],      "Cloud Engineer"),
    (["android developer", "android engineer", "ios developer",
      "ios engineer", "mobile developer", "mobile engineer",
      "flutter developer", "react native developer", "swift developer",
      "kotlin developer", "cross-platform developer"],                         "Mobile Developer"),
]

# ── Skill extraction — tags/keywords we recognise ─────────────────────────────
_KNOWN_SKILLS: set[str] = {
    "python", "java", "javascript", "typescript", "c++", "c#", "go", "rust",
    "ruby", "php", "swift", "kotlin", "scala", "dart",
    "react", "angular", "vue", "next.js", "nuxt", "svelte", "node", "django",
    "flask", "fastapi", "spring", "express", "rails", "laravel", "nestjs",
    "sql", "postgresql", "mysql", "mongodb", "redis", "elasticsearch",
    "dynamodb", "cassandra", "bigquery", "snowflake",
    "aws", "azure", "gcp", "docker", "kubernetes", "terraform", "ansible",
    "linux", "git", "ci/cd", "jenkins", "github actions", "gitlab ci",
    "machine learning", "tensorflow", "pytorch", "scikit-learn", "pandas",
    "numpy", "spark", "hadoop", "kafka", "airflow", "dbt", "looker",
    "rest", "api", "graphql", "microservices", "grpc",
    "excel", "tableau", "power bi", "llm", "openai", "langchain",
    "react native", "flutter", "figma", "storybook",
}

# Tag normalisation: RemoteOK / Adzuna tags → canonical skill names
_TAG_MAP: dict[str, str] = {
    "js":                  "javascript",
    "ts":                  "typescript",
    "nodejs":              "node",
    "node.js":             "node",
    "reactjs":             "react",
    "react.js":            "react",
    "next":                "next.js",
    "nextjs":              "next.js",
    "vuejs":               "vue",
    "vue.js":              "vue",
    "nestjs":              "nestjs",
    "postgres":            "postgresql",
    "nosql":               "mongodb",
    "k8s":                 "kubernetes",
    "github-actions":      "ci/cd",
    "github actions":      "ci/cd",
    "gitlab-ci":           "ci/cd",
    "jenkins":             "ci/cd",
    "ml":                  "machine learning",
    "deep learning":       "machine learning",
    "ai":                  "machine learning",
    "data science":        "machine learning",
    "openai api":          "openai",
    "amazon web services": "aws",
    "fast api":            "fastapi",
    "powerbi":             "power bi",
    "react-native":        "react native",
    "golang":              "go",
    "c sharp":             "c#",
    "dotnet":              "c#",
    ".net":                "c#",
    "scikit":              "scikit-learn",
    "sklearn":             "scikit-learn",
    "postgre":             "postgresql",
}


def _normalise_tag(tag: str) -> str | None:
    """Normalise a raw tag string to a canonical skill name, or None to skip."""
    t = tag.lower().strip()
    if t in _TAG_MAP:
        return _TAG_MAP[t]
    if t in _KNOWN_SKILLS:
        return t
    return None


def _detect_role(title: str) -> str | None:
    """Map a job title to the nearest canonical role name."""
    title_lower = title.lower()
    for keywords, role in _ROLE_PATTERNS:
        if any(kw in title_lower for kw in keywords):
            return role
    return None


# ── Data source: RemoteOK ──────────────────────────────────────────────────────

def _fetch_remoteok() -> list[dict]:
    """Fetch recent tech jobs from RemoteOK (free, no auth)."""
    url = "https://remoteok.io/api"
    try:
        resp = requests.get(
            url,
            headers={"User-Agent": "CareerCoach-MarketBot/1.0"},
            timeout=15,
        )
        if resp.status_code != 200:
            logger.warning("RemoteOK returned %d", resp.status_code)
            return []
        data = resp.json()
        # First element is metadata dict, skip it
        jobs = [j for j in data if isinstance(j, dict) and j.get("position")]
        logger.info("RemoteOK: fetched %d jobs", len(jobs))
        return jobs
    except Exception as exc:
        logger.warning("RemoteOK fetch failed: %s", exc)
        return []


def _parse_remoteok_jobs(jobs: list[dict]) -> list[tuple[str, list[str]]]:
    """Extract (role, [skills]) pairs from RemoteOK job objects."""
    parsed: list[tuple[str, list[str]]] = []
    for job in jobs:
        title = job.get("position", "") or ""
        role  = _detect_role(title)
        if not role:
            continue
        tags = job.get("tags") or []
        skills = [s for t in tags if (s := _normalise_tag(t)) is not None]
        if skills:
            parsed.append((role, skills))
    return parsed


# ── Data source: Arbeitnow (free, no auth, 200+ remote tech jobs) ──────────────

def _fetch_arbeitnow() -> list[dict]:
    """Fetch remote tech jobs from Arbeitnow (free, no auth required)."""
    all_jobs: list[dict] = []
    for page in range(1, 5):  # fetch up to 4 pages × 100 = 400 jobs
        try:
            resp = requests.get(
                "https://arbeitnow.com/api/job-board-api",
                params={"page": page},
                headers={"User-Agent": "CareerCoach-MarketBot/1.0"},
                timeout=10,
            )
            if resp.status_code != 200:
                break
            data = resp.json().get("data", [])
            if not data:
                break
            all_jobs.extend(data)
        except Exception as exc:
            logger.warning("Arbeitnow page %d failed: %s", page, exc)
            break
    logger.info("Arbeitnow: fetched %d jobs", len(all_jobs))
    return all_jobs


def _parse_arbeitnow_jobs(jobs: list[dict]) -> list[tuple[str, list[str]]]:
    """Extract (role, [skills]) pairs from Arbeitnow job objects."""
    parsed: list[tuple[str, list[str]]] = []
    for job in jobs:
        title = job.get("title", "") or ""
        role = _detect_role(title)
        if not role:
            continue
        # Arbeitnow provides a 'tags' list and a 'description' field
        tags: list[str] = job.get("tags") or []
        skills = [s for t in tags if (s := _normalise_tag(t)) is not None]
        if not skills:
            desc = (job.get("description") or "").lower()
            skills = [sk for sk in _KNOWN_SKILLS if sk in desc]
        if skills:
            parsed.append((role, skills))
    return parsed


# ── Data source: JSearch via RapidAPI (Indeed + LinkedIn + Glassdoor) ─────────

_JSEARCH_QUERIES: list[tuple[str, str]] = [
    ("frontend developer",   "Frontend Developer"),
    ("backend developer",    "Backend Developer"),
    ("full stack developer", "Full Stack Developer"),
    ("data scientist",       "Data Scientist"),
    ("data analyst",         "Data Analyst"),
    ("devops engineer",      "DevOps Engineer"),
    ("cloud engineer",       "Cloud Engineer"),
    ("mobile developer",     "Mobile Developer"),
]


def _fetch_jsearch_role(query: str, num_pages: int = 2) -> list[dict]:
    """Fetch jobs from JSearch (RapidAPI) — aggregates Indeed, LinkedIn, Glassdoor."""
    key = _get_rapidapi_key()
    if not key:
        return []
    url = "https://jsearch.p.rapidapi.com/search"
    headers = {
        "x-rapidapi-host": "jsearch.p.rapidapi.com",
        "x-rapidapi-key":  key,
    }
    params = {
        "query":      query,
        "num_pages":  str(num_pages),
        "date_posted": "month",
    }
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=int(os.getenv("JSEARCH_TIMEOUT", "25")))
        if resp.status_code == 429:
            logger.warning("JSearch rate limit hit (429) for '%s'", query)
            return []
        if resp.status_code != 200:
            logger.warning("JSearch returned %d for '%s'", resp.status_code, query)
            return []
        jobs = resp.json().get("data", [])
        logger.info("JSearch: %d jobs for '%s'", len(jobs), query)
        return jobs
    except Exception as exc:
        logger.warning("JSearch fetch failed for '%s': %s", query, exc)
        return []


def _parse_jsearch_jobs(jobs: list[dict], role: str) -> list[tuple[str, list[str]]]:
    """Extract (role, [skills]) from JSearch job objects.

    Uses the structured job_required_skills list when available,
    falls back to scanning the job_description text.
    """
    parsed: list[tuple[str, list[str]]] = []
    for job in jobs:
        # Use structured skills list if provided by JSearch
        structured: list[str] = job.get("job_required_skills") or []
        skills: list[str] = [s for raw in structured if (s := _normalise_tag(raw)) is not None]

        # Fall back to full text scan
        if not skills:
            desc = (job.get("job_description") or "").lower()
            highlights = job.get("job_highlights") or {}
            quals = " ".join(highlights.get("Qualifications") or []).lower()
            text = desc + " " + quals
            skills = [sk for sk in _KNOWN_SKILLS if sk in text]

        if skills:
            parsed.append((role, skills))
    return parsed


# ── Data source: Adzuna ────────────────────────────────────────────────────────

def _fetch_adzuna_role(role_query: str, country: str = "in") -> list[dict]:
    """Fetch jobs for *role_query* from Adzuna (requires API key)."""
    if not _ADZUNA_APP_ID or not _ADZUNA_APP_KEY:
        return []
    url = (
        f"https://api.adzuna.com/v1/api/jobs/{country}/search/1"
        f"?app_id={_ADZUNA_APP_ID}&app_key={_ADZUNA_APP_KEY}"
        f"&results_per_page=50&what={requests.utils.quote(role_query)}"
        f"&content-type=application/json"
    )
    try:
        resp = requests.get(url, timeout=15)
        if resp.status_code != 200:
            return []
        return resp.json().get("results", [])
    except Exception as exc:
        logger.warning("Adzuna fetch failed for '%s': %s", role_query, exc)
        return []


def _parse_adzuna_jobs(jobs: list[dict], role: str) -> list[tuple[str, list[str]]]:
    """Extract (role, [skills]) from Adzuna job descriptions."""
    parsed: list[tuple[str, list[str]]] = []
    for job in jobs:
        description = (job.get("description") or "").lower()
        skills = [
            skill for skill in _KNOWN_SKILLS
            if skill in description
        ]
        if skills:
            parsed.append((role, skills))
    return parsed


# ── Core computation ───────────────────────────────────────────────────────────

def _compute_frequencies(
    role_skill_pairs: list[tuple[str, list[str]]]
) -> dict[str, dict[str, float]]:
    """Convert raw (role, [skill]) pairs into normalised 0–1 frequency dicts."""
    # Count skill appearances per role
    role_counts: dict[str, Counter] = defaultdict(lambda: defaultdict(int))
    role_job_count: dict[str, int]  = defaultdict(int)

    for role, skills in role_skill_pairs:
        role_job_count[role] += 1
        for skill in skills:
            role_counts[role][skill] += 1

    # Normalise: skill_freq = appearances / total_jobs_for_role
    result: dict[str, dict[str, float]] = {}
    for role, counts in role_counts.items():
        n = role_job_count[role]
        result[role] = {skill: round(count / n, 4) for skill, count in counts.items()}

    return result


def _merge_with_static(
    live: dict[str, dict[str, float]],
    static: dict[str, dict[str, float]],
    live_weight: float = 0.80,
) -> dict[str, dict[str, float]]:
    """Blend live job data with existing static baseline.

    Roles with enough live data (>= 20 jobs for that role) use mostly live data.
    Roles with sparse live data keep static data with light live blend.
    """
    merged: dict[str, dict[str, float]] = {}
    all_roles = set(list(live.keys()) + list(static.keys()))

    for role in all_roles:
        live_skills   = live.get(role, {})
        static_skills = static.get(role, {})
        all_skills    = set(list(live_skills.keys()) + list(static_skills.keys()))

        if len(live_skills) < 5:
            # Too few live signals — keep static
            merged[role] = static_skills
            continue

        blended: dict[str, float] = {}
        for skill in all_skills:
            lv = live_skills.get(skill, 0.0)
            sv = static_skills.get(skill, 0.0)
            blended[skill] = round(lv * live_weight + sv * (1 - live_weight), 4)

        merged[role] = blended

    return merged


# ── Public API ─────────────────────────────────────────────────────────────────

def refresh_market_data(write: bool = True) -> dict:
    """Pull live job data and refresh market_skills.json.

    Args:
        write: If True (default), persist the merged result to disk.

    Returns:
        Summary dict: {roles_updated, total_jobs_processed, source_counts, ...}
    """
    t0 = time.monotonic()

    # Load current data as baseline (S3/tmp takes priority over bundled static)
    try:
        static_data: dict = get_market_data()
    except Exception as exc:
        logger.warning("Could not load market baseline data: %s", exc)
        static_data = {}

    all_pairs: list[tuple[str, list[str]]] = []

    # Source 1: RemoteOK
    remoteok_jobs = _fetch_remoteok()
    remoteok_pairs = _parse_remoteok_jobs(remoteok_jobs)
    all_pairs.extend(remoteok_pairs)
    logger.info("RemoteOK: %d relevant job pairs extracted", len(remoteok_pairs))

    # Source 2: Arbeitnow (free, no auth)
    arbeitnow_jobs = _fetch_arbeitnow()
    arbeitnow_pairs = _parse_arbeitnow_jobs(arbeitnow_jobs)
    all_pairs.extend(arbeitnow_pairs)
    logger.info("Arbeitnow: %d relevant job pairs extracted", len(arbeitnow_pairs))

    # Source 3: JSearch / RapidAPI (Indeed + LinkedIn + Glassdoor) — parallel
    jsearch_total = 0
    if _get_rapidapi_key():
        def _jsearch_fetch(query_role):
            query, role = query_role
            jobs = _fetch_jsearch_role(query, num_pages=3)
            return _parse_jsearch_jobs(jobs, role)

        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {pool.submit(_jsearch_fetch, qr): qr for qr in _JSEARCH_QUERIES}
            for fut in as_completed(futures):
                try:
                    pairs = fut.result()
                    all_pairs.extend(pairs)
                    jsearch_total += len(pairs)
                except Exception as exc:
                    logger.warning("JSearch worker failed: %s", exc)
        logger.info("JSearch: %d relevant job pairs extracted", jsearch_total)
    else:
        logger.info("JSearch skipped — RAPIDAPI_KEY not set or empty")

    # Source 4: Adzuna — parallel across roles
    adzuna_total = 0
    if _ADZUNA_APP_ID:
        adzuna_queries = [
            ("backend developer",    "Backend Developer"),
            ("frontend developer",   "Frontend Developer"),
            ("data scientist",       "Data Scientist"),
            ("devops engineer",      "DevOps Engineer"),
            ("full stack developer", "Full Stack Developer"),
            ("data analyst",         "Data Analyst"),
        ]

        def _adzuna_fetch(query_role):
            query, role = query_role
            jobs = _fetch_adzuna_role(query)
            return _parse_adzuna_jobs(jobs, role)

        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = {pool.submit(_adzuna_fetch, qr): qr for qr in adzuna_queries}
            for fut in as_completed(futures):
                try:
                    pairs = fut.result()
                    all_pairs.extend(pairs)
                    adzuna_total += len(pairs)
                except Exception as exc:
                    logger.warning("Adzuna worker failed: %s", exc)
        logger.info("Adzuna: %d relevant job pairs extracted", adzuna_total)

    if not all_pairs:
        logger.warning("No live job data fetched — market_skills.json not updated")
        return {"roles_updated": 0, "total_jobs_processed": 0, "elapsed_s": round(time.monotonic() - t0, 1)}

    live_frequencies = _compute_frequencies(all_pairs)
    merged = _merge_with_static(live_frequencies, static_data)

    # Sort each role's skills by frequency descending
    for role in merged:
        merged[role] = dict(sorted(merged[role].items(), key=lambda x: x[1], reverse=True))

    if write:
        # Write to /tmp (Lambda-writable) then persist to S3
        _TMP_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(_TMP_PATH, "w") as fh:
            json.dump(merged, fh, indent=2)
        try:
            _s3().upload_file(str(_TMP_PATH), _S3_BUCKET, _S3_KEY)
            logger.info("market_skills.json uploaded to s3://%s/%s", _S3_BUCKET, _S3_KEY)
        except Exception as exc:
            logger.warning("S3 upload failed (data saved to /tmp only): %s", exc)
        logger.info("market_skills.json updated with %d roles", len(merged))

    elapsed = round(time.monotonic() - t0, 1)
    return {
        "roles_updated":        len(merged),
        "total_jobs_processed": len(all_pairs),
        "sources": {
            "remoteok":   len(remoteok_pairs),
            "arbeitnow":  len(arbeitnow_pairs),
            "jsearch":    jsearch_total,
            "adzuna":     adzuna_total,
        },
        "elapsed_s": elapsed,
        "written":   write,
    }


def get_top_skills_for_role(role: str, top_n: int = 15) -> dict[str, float]:
    """Return the top-N skills by market demand for a given role."""
    try:
        data = get_market_data()
    except Exception:
        return {}
    role_data = data.get(role, {})
    sorted_skills = sorted(role_data.items(), key=lambda x: x[1], reverse=True)
    return dict(sorted_skills[:top_n])


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)
    result = refresh_market_data(write="--dry-run" not in sys.argv)
    print(json.dumps(result, indent=2))
