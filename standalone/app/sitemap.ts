import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
 return [{ url: "https://archindus.stevenscadet.chatgpt.site/", changeFrequency: "weekly", priority: 1 }];
}
