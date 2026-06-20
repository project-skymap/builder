import type { HorizonThemeConfig } from "@project-skymap/library";

export type HorizonColorMode = "light" | "dark" | "custom";
export type CustomHorizonFill = "solid" | "radial";

export type PreviewCustomHorizonDefaults = {
  mode: HorizonColorMode;
  fill: CustomHorizonFill;
  groundColor: string;
  horizonLineColor: string;
  gradientInnerColor: string;
  gradientOuterColor: string;
  gradientRadius: number;
  gradientIntensity: number;
};

export const PREVIEW_CUSTOM_HORIZON_DEFAULTS: PreviewCustomHorizonDefaults = {
  mode: "custom",
  fill: "solid",
  groundColor: "#040e3e",
  horizonLineColor: "#2c3358",
  gradientInnerColor: "#1d2b18",
  gradientOuterColor: "#020302",
  gradientRadius: 0.95,
  gradientIntensity: 1,
};

export function buildCustomHorizonTheme(
  selectedTheme: HorizonThemeConfig,
  custom: PreviewCustomHorizonDefaults,
): HorizonThemeConfig {
  return {
    ...selectedTheme,
    id: `${selectedTheme.id}-custom`,
    label: `${selectedTheme.label} Custom`,
    groundColor: custom.groundColor,
    groundGradient: custom.fill === "radial"
      ? {
          type: "radial",
          innerColor: custom.gradientInnerColor,
          outerColor: custom.gradientOuterColor,
          radius: custom.gradientRadius,
          intensity: custom.gradientIntensity,
        }
      : undefined,
    horizonLineColor: custom.horizonLineColor,
  };
}
