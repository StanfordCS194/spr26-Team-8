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

export async function extractSearchableTextFromImage(
  localFileUri: string,
  ctx: VisionExtractContext,
): Promise<string> {
  if (!USE_VISION_TEXT_EXTRACTION) return "";
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    if (__DEV__) {
      console.warn(
        "[Vision] EXPO_PUBLIC_ANTHROPIC_API_KEY is not set; upload continues without a generated description. Add the key to .env to enable Claude Haiku image tagging (see .env.example)."
      );
    }
    return "";
  }

  // Resize to max 1568px and compress to stay under Anthropic's 5MB image limit
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
    const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Vision API error ${res.status}: ${errBody.error?.message ?? "unknown error"}`);
  }
  const json = (await res.json()) as { content?: { text?: string }[] };
  const text = json.content?.[0]?.text;
  if (!text) throw new Error("Vision API returned no content");
  return text;
}
