import {providerConfiguration} from './providers';
import { env } from "cloudflare:workers";
import { configuredLimits, type UsageDb } from "./budget";

export function hostedEnvironment() {
  const values = env as unknown as Record<string, unknown>;
  const value = (key: string) => typeof values[key] === "string" ? (values[key] as string).trim() : undefined;
  return {
    routerSecret:value("ARCHINDUS_INTERNAL_AUTH_SECRET"),
    providers:providerConfiguration(values).providers,
    key: value("OPENAI_API_KEY"),
    enabled: value("ARCHINDUS_HOSTED_ENABLED") === "true",
    db: values.DB as UsageDb | undefined,
    limits: configuredLimits(value("ARCHINDUS_DAILY_USD"), value("ARCHINDUS_MONTHLY_USD")),
  };
}
