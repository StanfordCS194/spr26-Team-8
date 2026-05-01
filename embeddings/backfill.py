"""Backfill image embeddings for existing memories.

Run once after deploying the sidecar. Idempotent — safe to re-run.

Required env vars:
  SUPABASE_URL                — same value as EXPO_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY   — Project Settings → API → service_role key
  EMBED_SIDECAR_URL           — deployed Modal URL (no trailing slash)
"""

from __future__ import annotations

import os
import sys
from typing import Any

import requests

MODEL_NAME = "MobileCLIP-S0"
STORAGE_BUCKET = "memories"


def env(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        sys.exit(f"missing env: {name}")
    return val


def main() -> None:
    supabase_url = env("SUPABASE_URL").rstrip("/")
    service_key = env("SUPABASE_SERVICE_ROLE_KEY")
    sidecar_url = env("EMBED_SIDECAR_URL").rstrip("/")

    sb_headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }

    memories_resp = requests.get(
        f"{supabase_url}/rest/v1/memories",
        headers=sb_headers,
        params={
            "select": "memory_id,user_id,file_id,files(storage_path)",
            "file_id": "not.is.null",
        },
        timeout=30,
    )
    memories_resp.raise_for_status()
    memories: list[dict[str, Any]] = memories_resp.json()

    existing_resp = requests.get(
        f"{supabase_url}/rest/v1/image_embeddings",
        headers=sb_headers,
        params={"select": "memory_id", "model_name": f"eq.{MODEL_NAME}"},
        timeout=30,
    )
    existing_resp.raise_for_status()
    have: set[str] = {row["memory_id"] for row in existing_resp.json()}

    todo = [m for m in memories if m["memory_id"] not in have]
    print(f"memories with files: {len(memories)}; already embedded: {len(have)}; backfilling: {len(todo)}")

    inserted = 0
    skipped = 0
    for m in todo:
        memory_id = m["memory_id"]
        user_id = m["user_id"]
        files = m.get("files")
        storage_path = files["storage_path"] if isinstance(files, dict) else None
        if not storage_path:
            skipped += 1
            continue

        download = requests.get(
            f"{supabase_url}/storage/v1/object/{STORAGE_BUCKET}/{storage_path}",
            headers=sb_headers,
            timeout=60,
        )
        if download.status_code != 200:
            print(f"  skip {memory_id}: storage {download.status_code}")
            skipped += 1
            continue

        embed = requests.post(
            f"{sidecar_url}/embed/image",
            headers={
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/octet-stream",
            },
            data=download.content,
            timeout=60,
        )
        if embed.status_code != 200:
            print(f"  skip {memory_id}: embed {embed.status_code} {embed.text[:200]}")
            skipped += 1
            continue
        embedding = embed.json()["embedding"]

        insert = requests.post(
            f"{supabase_url}/rest/v1/image_embeddings",
            headers={
                **sb_headers,
                "Content-Type": "application/json",
                "Prefer": "resolution=ignore-duplicates",
            },
            json={
                "memory_id": memory_id,
                "user_id": user_id,
                "model_name": MODEL_NAME,
                "embedding": embedding,
            },
            timeout=30,
        )
        if insert.status_code not in (200, 201):
            print(f"  skip {memory_id}: insert {insert.status_code} {insert.text[:200]}")
            skipped += 1
            continue
        inserted += 1
        if inserted % 10 == 0:
            print(f"  ... {inserted} inserted")

    print(f"done: inserted={inserted}, skipped={skipped}")


if __name__ == "__main__":
    main()
