import type { NativeIntent } from "expo-router";

/**
 * expo-sharing opens the host app with `{scheme}://expo-sharing` after handling a share.
 * That path has no matching file route, so Expo Router showed "Unmatched route".
 * Rewrite it to Library where useIncomingShare consumes the payload.
 */
export const redirectSystemPath: NonNullable<NativeIntent["redirectSystemPath"]> = ({
  path,
}) => {
  if (/expo-sharing/i.test(path)) {
    return "/(tabs)/archive";
  }
  return path;
};
