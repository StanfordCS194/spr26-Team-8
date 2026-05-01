# Image embedding sidecar

MobileCLIP-S0 inference for the Library tab's semantic search. Runs as a single FastAPI app: locally under `uvicorn` for development, or deployed to [Modal](https://modal.com) for end users.

The same `app.py` works in both contexts — the Modal wrapper at the bottom is a no-op outside Modal.

## Credentials

Five values total. Each lives in exactly one place.

| Value | Where it lives | How to obtain |
|---|---|---|
| `EXPO_PUBLIC_EMBED_SIDECAR_URL` | Project root `.env` (alongside `EXPO_PUBLIC_SUPABASE_URL`) | Output of `modal deploy embeddings/app.py`. Copy the `Created web endpoint => https://...modal.run` URL. |
| `SUPABASE_JWT_SECRET` | Modal Secret named `supabase-jwt`. **Not in any `.env`.** | Supabase dashboard → **Project Settings → API → JWT Settings → JWT Secret → Reveal**. |
| `SUPABASE_URL` | Project root `.env` (already set as `EXPO_PUBLIC_SUPABASE_URL`; backfill reads the same value). | Already in your existing `.env`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Project root `.env`, commented out by default; uncomment only when running backfill. Never `EXPO_PUBLIC_`. | Supabase dashboard → **Project Settings → API → Project API keys → `service_role` → Reveal**. Treat like a database password. |
| `EMBED_SIDECAR_REQUIRE_AUTH` | Inline shell var when running `uvicorn` locally. Defaults to `true` on Modal. | Not a secret — set to `false` only to bypass JWT verification during first-day local debugging. |

The Modal CLI authenticates separately via `modal token new` (one-time, browser flow). That state lives in `~/.modal.toml`.

## One-time external setup (~10 min, all free)

1. **Enable pgvector**: Supabase dashboard → **Database → Extensions** → search `vector` → toggle **Enable**.
2. **Apply migration**: Supabase dashboard → **SQL Editor → + New query** → paste the contents of `supabase/migrations/20260501215951_image_embeddings.sql` → **Run**. Expect "Success. No rows returned."
3. **Modal account**: sign up at [modal.com](https://modal.com) (GitHub OAuth, no card). Free tier: $30/mo credit.
4. **Modal CLI**: `pip install modal && modal token new`.
5. **Modal Secret**: `modal secret create supabase-jwt SUPABASE_JWT_SECRET=<paste from Credentials row 2>`.
6. **Deploy**: `modal deploy embeddings/app.py`. Copy the URL from the output.
7. **Wire client**: add `EXPO_PUBLIC_EMBED_SIDECAR_URL=<copied URL>` to project `.env`. Restart Metro.

## Local dev (optional, before deploying)

```sh
pip install -r embeddings/requirements.txt uvicorn
EMBED_SIDECAR_REQUIRE_AUTH=false uvicorn embeddings.app:app --reload
```

Set `EXPO_PUBLIC_EMBED_SIDECAR_URL=http://localhost:8000` for the iOS Simulator; for a physical phone use the dev machine's LAN IP.

## Backfill (one-time after deploy)

Populate embeddings for memories that already exist. Idempotent — safe to re-run.

```sh
SUPABASE_URL=<dashboard value> \
SUPABASE_SERVICE_ROLE_KEY=<dashboard value> \
EMBED_SIDECAR_URL=<modal URL> \
python embeddings/backfill.py
```

## Verifying

```sh
curl -s "$EMBED_SIDECAR_URL/healthz"
# {"ok": true, "model_name": "MobileCLIP-S0", "dimension": 512}
```

A `POST /embed/text` with no `Authorization` header should return 401 (Modal); a request with a valid Supabase user JWT should return a length-512 array.
