export const spacingTokens = ["xs", "sm", "md", "lg", "xl"] as const;
export const radiusTokens = ["none", "sm", "md", "lg", "xl"] as const;
export const fontSizeTokens = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl"] as const;
export const elevationTokens = ["none", "low", "medium", "high"] as const;
export const colorRoleTokens = ["primary", "secondary", "accent", "surface", "muted", "danger"] as const;

export type SpacingToken = (typeof spacingTokens)[number];
export type RadiusToken = (typeof radiusTokens)[number];
export type FontSizeToken = (typeof fontSizeTokens)[number];
export type ElevationToken = (typeof elevationTokens)[number];
export type ColorRoleToken = (typeof colorRoleTokens)[number];

export type TokenType = "spacing" | "radius" | "fontSize" | "elevation" | "colorRole";

export const tokenSets: Record<TokenType, readonly string[]> = {
  spacing: spacingTokens,
  radius: radiusTokens,
  fontSize: fontSizeTokens,
  elevation: elevationTokens,
  colorRole: colorRoleTokens
};

export function isValidToken(type: TokenType, value: unknown): value is string {
  return typeof value === "string" && tokenSets[type].includes(value);
}
