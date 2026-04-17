Siya Goel

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
