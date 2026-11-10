import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
 return { rules: { userAgent: "*", allow: "/" }, sitemap: "https://archindus.stevenscadet.chatgpt.site/sitemap.xml" };
}
