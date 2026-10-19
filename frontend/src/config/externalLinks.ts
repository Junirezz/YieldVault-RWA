/**
 * Third-party link endpoints that are not network-specific. They live here
 * instead of inline in components so a deployment can swap them in one place.
 */
export const socialShareBaseUrls = {
  twitter: "https://twitter.com/intent/tweet",
  facebook: "https://www.facebook.com/sharer/sharer.php",
  telegram: "https://t.me/share/url",
} as const;
