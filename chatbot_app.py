import base64
import os
from typing import List

import streamlit as st
from openai import OpenAI


MODEL_NAME = "gpt-4.1-mini"


def _encode_image_bytes(image_bytes: bytes) -> str:
    return base64.b64encode(image_bytes).decode("utf-8")


def _build_prompt(question: str) -> str:
    return (
        "You are an image-aware personal archive assistant.\n"
        "The user uploads photos/screenshots/journal pages and asks memory queries.\n"
        "Answer only from visual evidence in the uploaded images.\n"
        "If the evidence is weak or missing, explicitly say what is uncertain.\n"
        "When useful, cite which uploaded image number supports the claim.\n\n"
        f"User question: {question}"
    )


def answer_with_vision(question: str, uploaded_images: List[bytes]) -> str:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return (
            "I need an `OPENAI_API_KEY` environment variable to analyze uploaded images. "
            "After setting it, rerun this app and ask your question again."
        )

    client = OpenAI(api_key=api_key)

    message_content = [{"type": "input_text", "text": _build_prompt(question)}]
    for image_bytes in uploaded_images:
        image_base64 = _encode_image_bytes(image_bytes)
        message_content.append(
            {
                "type": "input_image",
                "image_url": f"data:image/jpeg;base64,{image_base64}",
            }
        )

    response = client.responses.create(
        model=MODEL_NAME,
        input=[{"role": "user", "content": message_content}],
    )
    return response.output_text


st.set_page_config(page_title="Image Memory Chatbot", page_icon="🖼️")
st.title("Initial Image Memory Chatbot")
st.caption(
    "Upload images, then ask questions like "
    '"What white dresses did I save?" or '
    '"What places have I wanted to go this semester?"'
)

uploaded_files = st.file_uploader(
    "Upload one or more images",
    type=["png", "jpg", "jpeg", "webp"],
    accept_multiple_files=True,
)

question = st.text_input("Ask a question about your uploaded images")

if st.button("Analyze Images", type="primary"):
    if not uploaded_files:
        st.warning("Please upload at least one image first.")
    elif not question.strip():
        st.warning("Please enter a question.")
    else:
        with st.spinner("Analyzing images..."):
            image_payloads = [file.read() for file in uploaded_files]
            try:
                answer = answer_with_vision(question.strip(), image_payloads)
                st.success("Done")
                st.write(answer)
            except Exception as exc:  # noqa: BLE001
                st.error(f"Something went wrong: {exc}")
