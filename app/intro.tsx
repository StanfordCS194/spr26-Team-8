import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";
import { track } from "@/lib/posthog";

type Illustration = "venn" | "screenshot" | "share" | "lock";

type Page = {
  title: string;
  body: string;
  illustration: Illustration;
};

const PAGES: Page[] = [
  {
    title: "Welcome to Venn",
    body: "Expanding the overlap of things you want to do and things you actually do.",
    illustration: "venn",
  },
  {
    title: "Take a screenshot",
    body: "Snap anything you want to remember: a park, a restaurant, a recipe, an event.",
    illustration: "screenshot",
  },
  {
    title: "Share to Venn",
    body: "Share directly to Venn and we'll weave it all together.",
    illustration: "share",
  },
  {
    title: "Your data",
    body: "Your archive stays private. Only you can see what's inside.",
    illustration: "lock",
  },
];

// matches the app icon — terracotta + sage with a warm brown lens where they overlap
const CIRCLE_R = 78;
const COLOR_ORANGE = "#C16C42";
const COLOR_TEAL = "#739796";
const COLOR_OVERLAP = "#95816B";
// breathe between barely touching and deep logo-style overlap
const OFFSET_FAR = 70;
const OFFSET_NEAR = 32;
// canvas needs to fit the circles at peak separation: 2 * (OFFSET_FAR + R) plus a bit of breathing room
const SVG_WIDTH = 2 * (OFFSET_FAR + CIRCLE_R) + 24;
const SVG_HEIGHT = 2 * CIRCLE_R + 16;
const CENTER_X = SVG_WIDTH / 2;
const CENTER_Y = SVG_HEIGHT / 2;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

function VennAnimation({ active }: { active: boolean }) {
  // one shared value drives both circles, mirrored around center
  const offset = useSharedValue(OFFSET_FAR);

  useEffect(() => {
    if (active) {
      // breathe in and out forever while page 1 is on screen
      offset.value = withRepeat(
        withTiming(OFFSET_NEAR, { duration: 2200, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else {
      // snap back so we're not burning cycles in the background
      offset.value = OFFSET_FAR;
    }
  }, [active, offset]);

  const leftProps = useAnimatedProps(() => ({ cx: CENTER_X - offset.value }));
  const rightProps = useAnimatedProps(() => ({ cx: CENTER_X + offset.value }));

  // analytically compute the vesica-piscis lens path each frame so the overlap region matches the logo's brown
  const lensProps = useAnimatedProps(() => {
    const halfD = offset.value;
    if (halfD >= CIRCLE_R) return { d: "" };
    const h = Math.sqrt(CIRCLE_R * CIRCLE_R - halfD * halfD);
    const yTop = CENTER_Y - h;
    const yBot = CENTER_Y + h;
    // two arcs of radius R, one bulging right (left circle), one bulging left (right circle)
    return {
      d:
        `M ${CENTER_X} ${yTop} ` +
        `A ${CIRCLE_R} ${CIRCLE_R} 0 0 1 ${CENTER_X} ${yBot} ` +
        `A ${CIRCLE_R} ${CIRCLE_R} 0 0 1 ${CENTER_X} ${yTop} Z`,
    };
  });

  return (
    <View className="h-56 w-full items-center justify-center">
      <Svg width={SVG_WIDTH} height={SVG_HEIGHT}>
        <AnimatedCircle r={CIRCLE_R} cy={CENTER_Y} fill={COLOR_ORANGE} animatedProps={leftProps} />
        <AnimatedCircle r={CIRCLE_R} cy={CENTER_Y} fill={COLOR_TEAL} animatedProps={rightProps} />
        <AnimatedPath fill={COLOR_OVERLAP} animatedProps={lensProps} />
      </Svg>
    </View>
  );
}

// phone with a hard white flash, snap scale, and a thumbnail that drops to the corner — mimics iOS screenshot
function ScreenshotAnimation({ active }: { active: boolean }) {
  // single 0 → 1 driver, everything else is derived so the moments stay in sync
  const t = useSharedValue(0);

  useEffect(() => {
    if (active) {
      t.value = withRepeat(
        withTiming(1, { duration: 2000, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      t.value = 0;
    }
  }, [active, t]);

  // hard pop: 0 → ~0.06 ramps up to full white, holds, then fades out by ~0.30
  const flashStyle = useAnimatedStyle(() => {
    const v = t.value;
    let o = 0;
    if (v < 0.06) o = v / 0.06;
    else if (v < 0.14) o = 1;
    else if (v < 0.32) o = 1 - (v - 0.14) / 0.18;
    return { opacity: Math.max(0, Math.min(1, o)) };
  });

  // phone snaps bigger right when the flash fires, then settles
  const phoneStyle = useAnimatedStyle(() => {
    const v = t.value;
    let s = 1;
    if (v < 0.08) s = 1 + (v / 0.08) * 0.18;
    else if (v < 0.28) s = 1.18 - ((v - 0.08) / 0.2) * 0.18;
    return { transform: [{ scale: s }] };
  });

  // thumbnail appears after flash, slides from center down to the bottom-right corner, then fades
  const thumbnailStyle = useAnimatedStyle(() => {
    const v = t.value;
    let opacity = 0;
    let tx = 0;
    let ty = 0;
    let scl = 0.5;
    if (v >= 0.18 && v < 0.32) {
      // pops in at center over the phone
      const k = (v - 0.18) / 0.14;
      opacity = k;
      scl = 0.5 + k * 0.45;
    } else if (v >= 0.32 && v < 0.7) {
      // slides down-left to bottom-left corner (where iOS shows the thumbnail)
      const k = (v - 0.32) / 0.38;
      opacity = 1;
      scl = 0.95 - k * 0.45;
      tx = -k * 60;
      ty = k * 70;
    } else if (v >= 0.7 && v < 0.85) {
      // fades out
      const k = (v - 0.7) / 0.15;
      opacity = 1 - k;
      scl = 0.5;
      tx = -60;
      ty = 70;
    }
    return {
      opacity,
      transform: [{ translateX: tx }, { translateY: ty }, { scale: scl }],
    };
  });

  return (
    <View className="h-56 w-full items-center justify-center">
      <View className="relative h-44 w-44 items-center justify-center overflow-visible">
        <Animated.View style={phoneStyle}>
          <Ionicons name="phone-portrait-outline" size={144} color="#0B0B0B" />
        </Animated.View>
        {/* hard white flash inside the phone's screen area */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              width: 72,
              height: 116,
              borderRadius: 10,
              backgroundColor: "#FFFFFF",
            },
            flashStyle,
          ]}
        />
        {/* the captured screenshot thumbnail — slides down to corner, like iOS */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              width: 60,
              height: 96,
              borderRadius: 10,
              backgroundColor: "#FFFFFF",
              borderWidth: 2,
              borderColor: "#0B0B0B",
            },
            thumbnailStyle,
          ]}
        />
      </View>
    </View>
  );
}

// share icon gets visibly tapped: press-in scale, tap-ripple, then a chevron flies up to confirm the share
function ShareAnimation({ active }: { active: boolean }) {
  const t = useSharedValue(0);

  useEffect(() => {
    if (active) {
      t.value = withRepeat(
        withTiming(1, { duration: 1800, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      t.value = 0;
    }
  }, [active, t]);

  // press-in then snap back, like a button being tapped
  const iconStyle = useAnimatedStyle(() => {
    const v = t.value;
    let s = 1;
    let o = 1;
    if (v < 0.1) {
      s = 1;
    } else if (v < 0.2) {
      // press down
      const k = (v - 0.1) / 0.1;
      s = 1 - k * 0.16;
      o = 1 - k * 0.25;
    } else if (v < 0.3) {
      // snap back
      const k = (v - 0.2) / 0.1;
      s = 0.84 + k * 0.16;
      o = 0.75 + k * 0.25;
    }
    return { opacity: o, transform: [{ scale: s }] };
  });

  // ripple emanates outward right at the press moment, like material/iOS tap feedback
  const rippleStyle = useAnimatedStyle(() => {
    const v = t.value;
    let opacity = 0;
    let scale = 0.3;
    if (v >= 0.18 && v < 0.55) {
      const k = (v - 0.18) / 0.37;
      opacity = (1 - k) * 0.55;
      scale = 0.3 + k * 1.6;
    }
    return {
      opacity,
      transform: [{ scale }],
    };
  });

  return (
    <View className="h-56 w-full items-center justify-center">
      <View className="relative h-44 w-44 items-center justify-center">
        {/* tap ripple sits behind the icon */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              width: 110,
              height: 110,
              borderRadius: 55,
              borderWidth: 2,
              borderColor: "#0B0B0B",
            },
            rippleStyle,
          ]}
        />
        <Animated.View style={iconStyle}>
          <Ionicons name="share-outline" size={120} color="#0B0B0B" />
        </Animated.View>
      </View>
    </View>
  );
}

// crossfades between open and closed lock so it reads as the shackle clicking shut
function LockAnimation({ active }: { active: boolean }) {
  // 0 = open, 1 = closed. reverse-loops so it opens and closes on repeat
  const closed = useSharedValue(0);
  // small scale snap right around the click-shut moment
  const snap = useSharedValue(1);

  useEffect(() => {
    if (active) {
      closed.value = withRepeat(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.cubic) }),
        -1,
        true,
      );
      // slightly faster so the bump lands when the lock reaches closed
      snap.value = withRepeat(
        withTiming(1.08, { duration: 1400, easing: Easing.inOut(Easing.cubic) }),
        -1,
        true,
      );
    } else {
      closed.value = 0;
      snap.value = 1;
    }
  }, [active, closed, snap]);

  const openStyle = useAnimatedStyle(() => ({
    opacity: 1 - closed.value,
    transform: [{ scale: snap.value }],
  }));
  const closedStyle = useAnimatedStyle(() => ({
    opacity: closed.value,
    transform: [{ scale: snap.value }],
  }));

  return (
    <View className="h-56 w-full items-center justify-center">
      <View className="relative h-44 w-44 items-center justify-center">
        <Animated.View style={[{ position: "absolute" }, openStyle]}>
          <Ionicons name="lock-open-outline" size={128} color="#0B0B0B" />
        </Animated.View>
        <Animated.View style={[{ position: "absolute" }, closedStyle]}>
          <Ionicons name="lock-closed" size={128} color="#0B0B0B" />
        </Animated.View>
      </View>
    </View>
  );
}

export default function IntroScreen() {
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<Page>>(null);
  const [page, setPage] = useState(0);
  // remember which pages we've already logged so we don't double-fire
  const viewedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!viewedRef.current.has(page)) {
      viewedRef.current.add(page);
      track("intro_viewed", { page });
    }
  }, [page]);

  const finish = (skipped: boolean) => {
    track("intro_finished", { skipped });
    router.replace("/auth");
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== page) setPage(next);
  };

  const onPrimary = () => {
    if (page < PAGES.length - 1) {
      listRef.current?.scrollToIndex({ index: page + 1, animated: true });
      setPage(page + 1);
    } else {
      void finish(false);
    }
  };

  const isLast = page === PAGES.length - 1;

  return (
    <SafeAreaView className="flex-1 bg-[#F4F0EA]">
      <View className="flex-row items-center justify-end px-6 pt-2">
        <Pressable
          onPress={() => void finish(true)}
          hitSlop={16}
          className="active:opacity-60"
        >
          <Text className="text-lg font-black text-[#0B0B0B]">Skip</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={PAGES}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        className="flex-1"
        renderItem={({ item, index }) => (
          <View style={{ width }} className="flex-1 px-8">
            <View className="flex-1 items-center justify-center">
              {item.illustration === "venn" ? (
                <VennAnimation active={page === index} />
              ) : item.illustration === "screenshot" ? (
                <ScreenshotAnimation active={page === index} />
              ) : item.illustration === "share" ? (
                <ShareAnimation active={page === index} />
              ) : (
                <LockAnimation active={page === index} />
              )}
              {/* big chunky title, matches the wordmark style used in auth.tsx */}
              <Text className="mt-10 text-center text-5xl font-black leading-[52px] text-[#0B0B0B]">
                {item.title}
              </Text>
              <Text className="mt-5 text-center text-xl font-bold leading-7 text-[#0B0B0B]">
                {item.body}
              </Text>
            </View>
          </View>
        )}
      />

      <View className="items-center pb-4">
        <View className="flex-row gap-2">
          {PAGES.map((_, i) => (
            <View
              key={i}
              // active dot is wider and darker
              className={
                i === page
                  ? "h-2.5 w-8 rounded-full bg-[#0B0B0B]"
                  : "h-2.5 w-2.5 rounded-full bg-[#0B0B0B]/25"
              }
            />
          ))}
        </View>
      </View>

      <View className="px-6 pb-8 pt-2">
        <Pressable
          onPress={onPrimary}
          className="items-center rounded-2xl bg-[#0B0B0B] px-5 py-5 active:opacity-80"
        >
          <Text className="text-xl font-black text-white">
            {isLast ? "Get Started" : "Next"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
