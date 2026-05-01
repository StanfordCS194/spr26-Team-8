Siya Goel
Medhya Goel
Andreas Lorgen
J Yim

## Image chatbot prototype

This branch includes an initial image-aware chatbot app.

### Run locally

1. Install dependencies:
   `pip install -r requirements.txt`
2. Set your OpenAI key:
   `export OPENAI_API_KEY="your_key_here"`
3. Start the app:
   `streamlit run chatbot_app.py`

### What it does

- Upload one or more images.
- Ask natural-language questions about those uploaded images.
- Returns an answer grounded in the visible content (or says when evidence is uncertain).

---

## Venn mobile app (Expo)

This repo also contains a **React Native (Expo Router)** client under `app/`. It does **not** replace the Streamlit prototype above; they are separate entrypoints.

### Run locally

1. Use **Node 20+** (see `package.json` `engines` and optional `.nvmrc`).
2. `npm install`
3. Copy `.env.example` to `.env` and set:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
4. `npm start`, then open in **Expo Go**, or press `i` / `a` / `w` for simulator / web.

### Library search (what it does right now)

Search and light “clustering” for the **Library** tab (`app/(tabs)/archive.tsx`) live in `lib/archiveSearchAndCluster.ts`. Data is **on-device** unless teammates wire the integration hooks in `lib/teamIntegrationPlaceholders.ts`.

| Piece | Behavior |
| ----- | -------- |
| **Index** | Bundled images in `assets/files` plus user uploads copied under the app document directory. |
| **Query** | Query string is **tokenized**; **every** token must appear somewhere in the item’s `searchBlob` (AND semantics), not one long substring. |
| **searchBlob** | Lowercased join of id, file name, auto-tags, theme, and optional supplemental text (for future OCR/captions). |
| **Auto-tags** | Inferred from the file name (with stopwords); stored in `venn-archive-item-meta.json`. |
| **Theme chips** | Coarse keyword buckets (e.g. food, travel)—**not** embedding-based clusters. |
| **Ranking** | Among matches, **file name** and **tag** hits score above weak blob-only hits; sort by score, then file name. |
| **Match hints** | While searching, a tile may show short labels (e.g. “File name”, “Tag”) for transparency. |
| **Vision / OCR** | Off by default. When enabled, text from `placeholder_extractSearchableTextFromImage` merges into the same index via `lib/archiveSupplementalSearchText.ts`. |
| **Backend** | `lib/teamIntegrationPlaceholders.ts` defines no-op hooks for Supabase tags, embedding themes, index push, chat, and vision—flip flags and implement when ready. |

The **Action** tab is a **placeholder** chat UI for future generative features; it does not use `chatbot_app.py`.
