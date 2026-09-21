import os
import tempfile
import time

import openai
from dotenv import load_dotenv

load_dotenv()

# True on Vercel, where the filesystem is read-only apart from /tmp and each
# request may land on a different, cold instance with no shared memory.
SERVERLESS = bool(os.getenv("VERCEL"))

# Cache-buster appended to static URLs, so a deploy never serves stale CSS/JS.
STATIC_V = (
    os.getenv("VERCEL_GIT_COMMIT_SHA", "")[:8]
    or os.getenv("RENDER_GIT_COMMIT", "")[:8]
    or str(int(time.time()))
)

def env(name: str, default=None):
    """An unset variable and a variable set to "" mean the same thing here.

    They do not to os.getenv: a dashboard field left blank still *exists*, so
    getenv returns "" rather than the default. That crashed a production boot
    (`int("")` on REDIS_PORT) purely because the variable had been added and
    left empty, which is exactly what happens when someone fills in a hosting
    panel. Treat blank as absent everywhere instead.
    """
    value = os.getenv(name)
    return default if value is None or not value.strip() else value.strip()


def env_int(name: str, default: int) -> int:
    """Same, and never let a malformed value take the whole site down — a
    typo'd port is worth a log line and a default, not a 500 on every page."""
    raw = env(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        print(f"config: {name}={raw!r} is not a number; using {default}")
        return default


# OpenAI API configuration.
# Deliberately not fatal: the assistant needs this key, the marketing pages do
# not. Taking the whole site down over a missing chat credential is worse than
# serving the site and failing the one endpoint that needs it — and the failure
# is far easier to diagnose when /health can still answer.
OPENAI_API_KEY = env("OPENAI_API_KEY")
HAS_OPENAI_KEY = bool(OPENAI_API_KEY)
openai.api_key = OPENAI_API_KEY

CHAT_MODEL = env("CHAT_MODEL", "gpt-4.1")

# Redis configuration. REDIS_URL wins when present — it is what hosted
# providers hand you, and rediss:// carries the TLS setting and password
# without four separate variables. KV_URL is what Vercel's Upstash
# integration injects.
REDIS_URL = env("REDIS_URL") or env("KV_URL")
REDIS_HOST = env("REDIS_HOST", "localhost")
REDIS_PORT = env_int("REDIS_PORT", 6379)
REDIS_DB = env_int("REDIS_DB", 0)
REDIS_PASSWORD = env("REDIS_PASSWORD")
REDIS_PREFIX = "dispatchiq:"
REDIS_EXPIRATION = 60 * 60 * 24 * 7  # 7 days

# Audio uploads are transient: written, transcribed, deleted. On a read-only
# serverless filesystem that has to be the temp dir.
AUDIO_DIR = os.getenv(
    "AUDIO_DIR",
    os.path.join(tempfile.gettempdir(), "audio_uploads") if SERVERLESS else "audio_uploads",
)


# Company details injected into every template.
#
# CONTACT DETAILS ARE PLACEHOLDERS. Replace email/LinkedIn below (and nothing
# else) when the real ones exist — every page reads them from here, so one edit
# updates the whole site.
#
# Everything factual here comes from the five-year business plan. The plan is
# explicit (Appendix B, items 1–4) that no U.S. entity has been formed and no
# name selected yet, so "DispatchIQ" is the product name only — the site must
# not imply a registered company that does not exist.
COMPANY = {
    "name": "DispatchIQ",
    "legal_name": "DispatchIQ",
    "product": "AI Truck Dispatch Assistant",
    "tagline": "Helping you realize the full potential of AI-assisted dispatch",
    "status": "Pre-formation — U.S. entity not yet filed (Appendix B)",
    "market": "United States",
    "email": env("CONTACT_EMAIL", "hello@dispatchiq.com"),
    "phone": env("CONTACT_PHONE", "(555) 018-4420"),
    "linkedin": env("CONTACT_LINKEDIN", "https://www.linkedin.com/in/mukhlisa-latifova"),
    # Section 18 — illustrative pricing. The plan calls these planning
    # assumptions to be validated by market testing, and the pricing page says
    # so on the page rather than only here.
    "price_oo_low": "99",
    "price_oo_high": "199",
    "price_fleet_low": "299",
    "price_fleet_high": "699",
    "price_pro_low": "750",
    "price_pro_high": "1,500",
    "price_ent_from": "2,000",
}

# The founder, per Section 31 of the business plan. That section is the only
# source for anything asserted on her behalf, so this list stops exactly where
# the documentation does.
FOUNDER = {
    "name": "Mukhlisa Latifova",
    "role": "Founder & Chief Executive Officer",
    "home": "New York, New York",
    "credentials": [
        "Author of The Cross-Continental Dispatcher (2026), a professional reference on "
        "U.S. and EU truck dispatch compliance — ELD rules, hours-of-service, the EU "
        "Smart Tachograph regime, cabotage, and broker liability under Montgomery v. Caribe",
        "Completed “360 Degree of Logistics Basics and Practice” at Lucid Logistics Academy, "
        "Tashkent (April 2023) — an 18-lesson state-licensed dispatch program, 92% final exam, "
        "with a transcript recommendation for a dispatch “Update” position",
        "2014 Diploma of Academic Lyceum under Tashkent State Technical University, "
        "specialization in computer technologies",
        "Co-founder, 25% owner and co-manager with full signing authority of Armo Hospitality "
        "and Cleaning LLC, Doha, Qatar (2022) — QAR 200,000 capital",
        "Marketing Executive, Azym Technologies W.L.L., Doha, Qatar (from December 2020)",
        "In the United States on F-1 student status since August 2024, enrolled at Campus "
        "Education, Times Square, New York through September 2026",
    ],
}
