/**
 * Curated onboarding images with rich search text (same role as OCR/caption on uploads).
 * Stored in DB on selection so chat + weekly nudges can ground suggestions in profile interests.
 */

export type OnboardingStockImage = {
  id: string;
  label: string;
  /** Semantic text used like memory search blobs — not shown verbatim in UI. */
  searchText: string;
  source: number;
};

export const ONBOARDING_STOCK_IMAGES: OnboardingStockImage[] = [
  {
    id: "hiking",
    label: "Outdoors & hiking",
    searchText:
      "hiking trail mountains trekking backpacking outdoor adventure fitness nature weekend trip national park",
    source: require("@/assets/onboarding/hiking.png"),
  },
  {
    id: "beach-sunset",
    label: "Beach & coast",
    searchText:
      "beach sunset pier ocean coastal travel vacation summer evening waterfront relaxation",
    source: require("@/assets/onboarding/beach-sunset.png"),
  },
  {
    id: "concert",
    label: "Live music",
    searchText:
      "concert live music festival crowd stage band performance nightlife entertainment",
    source: require("@/assets/onboarding/concert.png"),
  },
  {
    id: "fine-dining",
    label: "Fine dining",
    searchText:
      "fine dining upscale restaurant city skyline romantic dinner luxury gastronomy date night",
    source: require("@/assets/onboarding/fine-dining.png"),
  },
  {
    id: "brunch",
    label: "Brunch & food",
    searchText:
      "brunch breakfast pancakes eggs benedict restaurant food cafe weekend meal dining with friends",
    source: require("@/assets/onboarding/brunch.png"),
  },
  {
    id: "cocktail-bar",
    label: "Bars & lounges",
    searchText:
      "cocktail bar lounge upscale nightlife drinks social evening out sophisticated",
    source: require("@/assets/onboarding/cocktail-bar.png"),
  },
  {
    id: "bookstore",
    label: "Books & reading",
    searchText:
      "bookstore books reading literature cozy shop indie books hobby learning",
    source: require("@/assets/onboarding/bookstore.png"),
  },
  {
    id: "coffee-shop",
    label: "Coffee shops",
    searchText:
      "coffee shop cafe specialty coffee community workspace third place urban",
    source: require("@/assets/onboarding/coffee-shop.png"),
  },
  {
    id: "nightclub",
    label: "Clubs & parties",
    searchText:
      "nightclub dance party EDM electronic music festival crowd high energy nightlife",
    source: require("@/assets/onboarding/nightclub.png"),
  },
  {
    id: "japanese-garden",
    label: "Gardens & calm",
    searchText:
      "japanese garden zen pond peaceful nature meditation park tranquil mindfulness",
    source: require("@/assets/onboarding/japanese-garden.png"),
  },
];

const byId = new Map(ONBOARDING_STOCK_IMAGES.map((img) => [img.id, img]));

export function getOnboardingStockImage(id: string): OnboardingStockImage | undefined {
  return byId.get(id);
}
