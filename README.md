# DispatchIQ — marketing site + AI copilot

A FastAPI site for the **AI Truck Dispatch Assistant** described in
`Dispatching_Business_Plan.pdf`, with the supplied chatbot backend wired in as
an on-site copilot.

**DispatchIQ is a working product name.** The plan (Appendix B, items 1–3) is
explicit that no U.S. entity has been formed and no company name has been
selected, so the site never implies a registered company, a shipped product,
a customer or any revenue. Change the name in one place — `COMPANY["name"]` in
`config.py` — when a real one is chosen.

## Run it

```bash
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env    # then put a real OPENAI_API_KEY in it
uvicorn main:app --reload --port 8010
```

The marketing pages render without an OpenAI key; only `/api/chat` needs one,
and `/health` reports `degraded` rather than the site failing to boot.

## Layout

```
main.py                     routes, sitemap, robots, health
config.py                   COMPANY + FOUNDER — every page reads from here
utils/conversation_utils.py the copilot's system prompt (the important file)
routes/                     chat + websocket endpoints (from the supplied zip)
templates/                  base + 7 pages
public/static/              css, js, images
```

Company facts, contact details and the pricing figures live in **`config.py`**
only. Nothing factual is hardcoded in a template, so one edit updates the whole
site.

### Pages

| Route | What it is |
|---|---|
| `/` | Home — hero, credentials strip, why, capability finder, segments, quote, market, notes, FAQ, CTA |
| `/platform` | The six planned pieces, the integration layers, the human-authority line, the regulatory posture |
| `/carriers` | Segmentation, the four customer tiers, the published competitive landscape |
| `/pricing` | The four illustrative tiers, what the price is measured against, honest comparison |
| `/company` | Status, founder, market sizing, 24-month plan, five-year roadmap, financial model, risks |
| `/demo` | The copilot, full-page, with what it will and will not do |
| `/privacy`, `/terms` | Scoped to this website, because there is no product to govern yet |

## The hero rotator

Three photographs crossfade every three seconds (`public/static/js/site.js`,
interval set by `data-interval` on `#heroStage`). It pauses when the hero
scrolls out of view, when the tab is hidden and on hover, stops entirely under
`prefers-reduced-motion`, and the markup already shows frame one — so with no
JavaScript the hero is simply a photograph rather than an empty box.

Each photo carries `data-pos` because they crop differently; the matching
`object-position` rules are in `site.css` next to `.hero__slide`.

## Components carried over

Ported from the Tora Labs site (`components.css` / `components.js`) and
re-themed green through CSS variables rather than edited: reveal-text (`.rt`),
rotating words (`.rotw`), typewriter (`.tw`), spotlight cards (`.spot`), flip
buttons (`.flipbtn`), glass buttons (`.btn--glass`), the FAQ accordion
(`.faq`). They read `--blue*`, which `site.css` aliases to the green tokens, so
a brand change is a handful of variables and not a find-and-replace.

## The copilot

`utils/conversation_utils.py` holds the system prompt. It is long on purpose:
every figure the assistant may state is written out, because the plan flags all
of them as planning assumptions and a model left to recall them states a firmer
number than the company has. It is instructed to:

- say it is an AI, unprompted;
- distinguish what is designed from what is only on the roadmap (Voice AI);
- refuse an accuracy percentage, a delivery date or any figure not on its list;
- never claim to be, or replace, an FMCSA-compliant ELD;
- refuse regulatory advice and hand off to the founder on request.

Verified behaviour — asked "does this replace my ELD, and how accurate is rate
con extraction, give me a percentage", it declines the percentage ("no live
product or test data, so no accuracy figures exist"), states the ELD boundary,
and asks one qualifying question.

## Images

All from Unsplash, credited in `public/static/images/CREDITS.md`.

**Only free-license photos** — `images.unsplash.com/photo-*`. Unsplash+ assets
(`plus.unsplash.com/premium_photo-*`) carry a baked-in "Unsplash+" watermark at
full resolution that is invisible in a thumbnail and obvious on a hero. CREDITS
also lists the photos rejected for showing another company's branding or the
wrong country, so the same picks are not made twice.

## Deploying

`render.yaml` (always-on process, Redis optional) or `vercel.json` (serverless,
**Redis required** — without it each request may hit a cold instance and
conversations and rate limits will not hold). `.vercelignore` keeps the
virtualenv, the business-plan PDF and the chatbot archive off the host.

Set `SITE_URL` to the real domain and flip `ALLOW_INDEXING=true` only once that
domain is serving; until then `robots.txt` disallows everything so the
temporary host never competes with the real one for the same content.

## Screenshots

`shot.py` in the session scratchpad drives headless Chrome over CDP for
full-page captures at an exact viewport width, and reports horizontal overflow.
Worth knowing if you rebuild it: `chrome --headless --window-size=390` does
**not** give a 390px viewport — Chrome clamps the window to ~500px and crops
the image to 390, so the layout is measured at the wrong width and the picture
hides it. Device metrics have to be set over the protocol.
