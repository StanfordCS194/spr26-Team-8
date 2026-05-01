"""MobileCLIP-S0 embedding sidecar.

Runs as either:
- Local FastAPI server: `uvicorn embeddings.app:app --reload`
- Modal deployment:    `modal deploy embeddings/app.py`

Image and text encoders share a single CLIP joint space, so a text query and
an image embedding can be cosine-compared directly.
"""

from __future__ import annotations

import io
import os
from typing import Optional

import jwt
import open_clip
import torch
from fastapi import Body, Depends, FastAPI, Header, HTTPException
from PIL import Image
from pydantic import BaseModel

MODEL_NAME = "MobileCLIP-S0"
DIMENSION = 512


def load_model():
    model, _, preprocess = open_clip.create_model_and_transforms(
        "MobileCLIP-S0", pretrained="datacompdr"
    )
    tokenizer = open_clip.get_tokenizer("MobileCLIP-S0")
    model.eval()
    return model, preprocess, tokenizer


model, preprocess, tokenizer = load_model()


def _l2_normalize(t: torch.Tensor) -> torch.Tensor:
    return t / t.norm(dim=-1, keepdim=True).clamp(min=1e-12)


def embed_image_bytes(b: bytes) -> list[float]:
    img = Image.open(io.BytesIO(b)).convert("RGB")
    tensor = preprocess(img).unsqueeze(0)
    with torch.no_grad():
        feats = model.encode_image(tensor)
    return _l2_normalize(feats)[0].tolist()


def embed_text(t: str) -> list[float]:
    tokens = tokenizer([t])
    with torch.no_grad():
        feats = model.encode_text(tokens)
    return _l2_normalize(feats)[0].tolist()


app = FastAPI()


def require_supabase_user(authorization: Optional[str] = Header(default=None)) -> str:
    if os.environ.get("EMBED_SIDECAR_REQUIRE_AUTH", "true").lower() == "false":
        return "local-dev"
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    secret = os.environ.get("SUPABASE_JWT_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="server missing SUPABASE_JWT_SECRET")
    token = authorization.split(" ", 1)[1].strip()
    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail=f"invalid token: {exc}") from exc
    sub = claims.get("sub") or claims.get("role")
    if not sub:
        raise HTTPException(status_code=401, detail="token missing sub")
    return str(sub)


class EmbedResponse(BaseModel):
    model_name: str
    dimension: int
    embedding: list[float]


class TextRequest(BaseModel):
    text: str


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "model_name": MODEL_NAME, "dimension": DIMENSION}


@app.post("/embed/image", response_model=EmbedResponse)
def embed_image_endpoint(
    raw: bytes = Body(..., media_type="application/octet-stream"),
    _user: str = Depends(require_supabase_user),
) -> EmbedResponse:
    if not raw:
        raise HTTPException(status_code=400, detail="empty image body")
    try:
        vec = embed_image_bytes(raw)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"could not decode image: {exc}") from exc
    return EmbedResponse(model_name=MODEL_NAME, dimension=DIMENSION, embedding=vec)


@app.post("/embed/text", response_model=EmbedResponse)
def embed_text_endpoint(
    body: TextRequest,
    _user: str = Depends(require_supabase_user),
) -> EmbedResponse:
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty text")
    vec = embed_text(text)
    return EmbedResponse(model_name=MODEL_NAME, dimension=DIMENSION, embedding=vec)


try:
    import modal
except ImportError:
    modal = None

if modal is not None:
    image = (
        modal.Image.debian_slim(python_version="3.11")
        .pip_install_from_requirements("embeddings/requirements.txt")
        .run_function(load_model)
    )
    modal_app = modal.App("memorial-embeddings", image=image)

    @modal_app.function(
        secrets=[modal.Secret.from_name("supabase-jwt")],
        enable_memory_snapshot=True,
        scaledown_window=300,
    )
    @modal.asgi_app()
    def fastapi_app():
        return app
