import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

function sanitizeFilePart(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "chat-output";
}

export async function exportChatTextToFile(title: string, text: string): Promise<string> {
  const safeTitle = sanitizeFilePart(title);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${safeTitle}-${timestamp}.txt`;
  const dir = `${FileSystem.documentDirectory}exports`;
  const uri = `${dir}/${fileName}`;

  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  await FileSystem.writeAsStringAsync(uri, text, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: "text/plain",
      UTI: "public.plain-text",
      dialogTitle: "Save or share output",
    });
  }

  return uri;
}
