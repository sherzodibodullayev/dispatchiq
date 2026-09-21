import os
import time
import logging
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

from config import AUDIO_DIR, COMPANY, FOUNDER, HAS_OPENAI_KEY, SERVERLESS, STATIC_V
from routes.chat_routes import router as chat_router
from routes.websocket_routes import router as websocket_router
from utils.conversation_utils import LANGUAGES
from utils.redis_utils import get_redis_client

# Configure logging. Serverless filesystems are read-only, and the host
# collects stdout anyway — a FileHandler there crashes the app at import.
_handlers = [logging.StreamHandler()]
if not SERVERLESS:
    _handlers.append(logging.FileHandler("app.log"))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=_handlers,
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="DispatchIQ API",
    description="AI Truck Dispatch Assistant — load matching, document intelligence and dispatcher copilot",
    version="1.0.0",
)

IS_PROD = os.getenv("ENV", "dev").lower() in ("prod", "production")

SESSION_SECRET = os.getenv("SESSION_SECRET")
if IS_PROD and not SESSION_SECRET:
    raise RuntimeError("SESSION_SECRET must be set when ENV=production")

app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET or "dev-only-secret")

# The browser client is same-origin, so CORS only needs to allow the sites we
# actually serve from. "*" with credentials is both invalid and an open door.
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)

# Absolute paths: a serverless entry point does not run with the project root
# as its working directory, and relative paths silently resolve to nothing.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

# Assets live under public/ so Vercel's CDN serves /static/* directly and the
# function never sees those requests — public/ is not even inside the lambda
# there, and StaticFiles raises on a missing directory. This mount is what
# serves the same paths everywhere else: locally, on Render, on a VM.
STATIC_DIR = os.path.join(BASE_DIR, "public", "static")
if os.path.isdir(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
else:
    logger.info("No local %s; assuming the host serves /static from a CDN.", STATIC_DIR)

os.makedirs(AUDIO_DIR, exist_ok=True)

app.include_router(chat_router)
# WebSockets do not work on serverless platforms. Nothing in the UI uses this
# route — it is here for hosts that do support it (Render, a VM).
app.include_router(websocket_router)

if SERVERLESS and get_redis_client() is None:
    logger.warning(
        "Serverless with no Redis: every request may hit a different instance, "
        "so conversation history and rate limits will not hold. Set REDIS_URL."
    )


def page(request: Request, template: str, **extra):
    """Render a template with the shared site context."""
    # In dev the stamp changes every request so CSS/JS edits show up without a
    # restart; in production it is fixed per deploy so browsers can cache.
    ctx = {
        "company": COMPANY,
        "founder": FOUNDER,
        "year": datetime.now().year,
        "v": STATIC_V if IS_PROD else str(time.time()),
        # Absolute origin for canonical and og: tags — a relative og:image is
        # ignored by every scraper that renders a link preview.
        "site_url": site_root(request),
    }
    ctx.update(extra)
    return templates.TemplateResponse(request, template, ctx)


@app.get("/", response_class=HTMLResponse)
async def get_home(request: Request):
    return page(request, "index.html", active="home")


@app.get("/platform", response_class=HTMLResponse)
async def get_platform(request: Request):
    return page(request, "platform.html", active="platform")


@app.get("/carriers", response_class=HTMLResponse)
async def get_carriers(request: Request):
    return page(request, "carriers.html", active="carriers")


@app.get("/pricing", response_class=HTMLResponse)
async def get_pricing(request: Request):
    return page(request, "pricing.html", active="pricing")


@app.get("/company", response_class=HTMLResponse)
async def get_company(request: Request):
    return page(request, "company.html", active="company")


@app.get("/demo", response_class=HTMLResponse)
async def get_demo(request: Request):
    return page(request, "demo.html", active="demo")


@app.get("/privacy", response_class=HTMLResponse)
async def get_privacy(request: Request):
    return page(request, "privacy.html", active="privacy")


@app.get("/terms", response_class=HTMLResponse)
async def get_terms(request: Request):
    return page(request, "terms.html", active="terms")


@app.get("/health")
async def health_check(deep: bool = False):
    """Health check. The host pings this constantly, so it stays cheap unless
    ?deep=1 is passed — otherwise every ping would hit the OpenAI API."""
    health_status = {
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "redis": "available" if get_redis_client() is not None else "memory-fallback",
        "openai_key": "set" if HAS_OPENAI_KEY else "MISSING",
    }
    if not HAS_OPENAI_KEY:
        health_status["status"] = "degraded"

    if deep:
        import openai
        try:
            openai.models.list()
            health_status["openai"] = "available"
        except Exception:
            health_status["openai"] = "unavailable"
            health_status["status"] = "degraded"

    return health_status


@app.get("/api/languages")
async def get_available_languages():
    """Return available languages for the application"""
    native = {"en": "English", "es": "Espanol", "uz": "O'zbek"}
    return {
        "languages": [
            {"code": code, "name": name, "native_name": native.get(code, name)}
            for code, name in LANGUAGES.items()
        ],
        "default": "en",
    }


@app.get("/api/disclaimer/{language}")
async def get_disclaimer(language: str = "en"):
    """Get the language-specific AI disclosure shown alongside the assistant."""
    disclaimers = {
        "en": {
            "title": "You are talking to an AI",
            "content": (
                "This is the DispatchIQ Copilot, an AI assistant — not a person. It answers from "
                "DispatchIQ's own business plan and hands you to Mukhlisa, the founder, the moment "
                "you ask for a human or it reaches the edge of what it knows. DispatchIQ is at the "
                "planning stage: pricing shown on this site is a published planning assumption, not "
                "a quoted price, and the product is not shipped yet."
            ),
        },
        "es": {
            "title": "Estas hablando con una IA",
            "content": (
                "Este es el Copilot de DispatchIQ, un asistente de IA, no una persona. Responde con "
                "el plan de negocio de DispatchIQ y te pasa con Mukhlisa, la fundadora, en cuanto "
                "pides hablar con alguien. DispatchIQ esta en fase de planificacion: los precios de "
                "este sitio son supuestos publicados, no un presupuesto."
            ),
        },
        "uz": {
            "title": "Siz sun'iy intellekt bilan suhbatlashyapsiz",
            "content": (
                "Bu DispatchIQ Copilot — sun'iy intellekt yordamchisi, inson emas. U DispatchIQ "
                "biznes-rejasi asosida javob beradi va siz odam bilan gaplashmoqchi bo'lsangiz, "
                "asoschi Mukhlisaga ulaydi. DispatchIQ hozircha rejalashtirish bosqichida: "
                "saytdagi narxlar — e'lon qilingan taxminlar, rasmiy taklif emas."
            ),
        },
    }
    return disclaimers.get(language, disclaimers["en"])


# Indexing stays off until the real domain is live. Without this the temporary
# host (…vercel.app) gets indexed and then competes with the real domain for
# the same content. Set ALLOW_INDEXING=true once the domain is attached.
ALLOW_INDEXING = os.getenv("ALLOW_INDEXING", "").lower() in ("1", "true", "yes")

SITEMAP_PAGES = [
    ("", "weekly", "1.0"),
    ("platform", "weekly", "0.9"),
    ("carriers", "weekly", "0.8"),
    ("pricing", "monthly", "0.8"),
    ("demo", "weekly", "0.8"),
    ("company", "monthly", "0.6"),
    ("privacy", "yearly", "0.3"),
    ("terms", "yearly", "0.3"),
]


# The one canonical origin. Set this to the real domain once it is attached:
# the .vercel.app copy then points its canonical, og:url and sitemap at the
# domain instead of competing with it for the same content.
# Unset = whatever host served the request, which is what dev wants.
SITE_URL = os.getenv("SITE_URL", "").rstrip("/")


def site_root(request: Request) -> str:
    """Public base URL, honouring the proxy the host puts in front of us."""
    if SITE_URL:
        return SITE_URL
    proto = request.headers.get("X-Forwarded-Proto", request.url.scheme)
    host = request.headers.get("X-Forwarded-Host") or request.headers.get("Host")
    return f"{proto}://{host}".rstrip("/")


@app.get("/robots.txt", response_class=PlainTextResponse)
async def get_robots(request: Request):
    if not ALLOW_INDEXING:
        return "User-agent: *\nDisallow: /\n"

    return (
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /api/\n"
        "Disallow: /health\n\n"
        f"Sitemap: {site_root(request)}/sitemap.xml\n"
    )


@app.get("/sitemap.xml")
async def get_sitemap(request: Request):
    root = site_root(request)
    urls = "".join(
        f"<url><loc>{root}/{path}</loc>"
        f"<changefreq>{freq}</changefreq><priority>{pri}</priority></url>"
        for path, freq, pri in SITEMAP_PAGES
    )
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        f"{urls}</urlset>"
    )
    return Response(xml, media_type="application/xml")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
