import type { NativeIntent } from "expo-router";

export const redirectSystemPath: NonNullable<NativeIntent["redirectSystemPath"]> = ({
  path,
}) => {
  if (/expo-sharing/i.test(path)) {
    return "/(tabs)/archive";
  }
  return path;
};
