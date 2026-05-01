/**
 * Claude Haiku image OCR. Called from archive.tsx after a photo upload to generate
 * a searchable text description that's stored in memories.ocr_description and merged
 * into the local search index.
 */

import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";

const USE_VISION_TEXT_EXTRACTION = true;

export type VisionExtractContext = {
  id: string;
  fileName: string;
  mimeType: string;
};

type AnthropicMessagesResponse = {
  content?: { text?: string }[];
};

type AnthropicErrorResponse = {
  error?: {
    message?: string;
    type?: string;
  };
};

function warnVisionExtractionSkipped(
  message: string,
  ctx: VisionExtractContext,
) {
  if (!__DEV__) return;
  console.warn(
    `[Vision] ${message}; upload continues without a generated description.`,
    {
      id: ctx.id,
      fileName: ctx.fileName,
      mimeType: ctx.mimeType,
    },
  );
}

export async function extractSearchableTextFromImage(
  localFileUri: string,
  ctx: VisionExtractContext,
): Promise<string> {
  if (!USE_VISION_TEXT_EXTRACTION) return "";
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    warnVisionExtractionSkipped("EXPO_PUBLIC_ANTHROPIC_API_KEY is not set", ctx);
    return "";
  }

  try {
    // Resize to max 1568px and compress to stay under Anthropic's 5MB image limit.
    const resized = await ImageManipulator.manipulateAsync(
      localFileUri,
      [{ resize: { width: 1568 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
    );
    const base64 = await FileSystem.readAsStringAsync(resized.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: base64,
                },
              },
              {
                type: "text",
                text: "Return a comma separated list of tags and/or description of the image",
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as AnthropicErrorResponse;
      const requestId = res.headers.get("request-id");
      const message = errBody.error?.message ?? "unknown error";
      warnVisionExtractionSkipped(
        `Claude image tagging HTTP ${res.status}: ${message}${requestId ? ` (request-id: ${requestId})` : ""}`,
        ctx,
      );
      return "";
    }
    const json = (await res.json()) as AnthropicMessagesResponse;
    const text = json.content?.[0]?.text;
    if (!text) {
      warnVisionExtractionSkipped("Claude image tagging returned no content", ctx);
      return "";
    }
    return text;
  } catch (err) {
    warnVisionExtractionSkipped(
      `Claude image tagging failed: ${err instanceof Error ? err.message : "unknown error"}`,
      ctx,
    );
    return "";
  }
}
