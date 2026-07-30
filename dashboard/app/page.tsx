import type { Metadata } from "next";
import { OperationsDashboard } from "./operations-dashboard";
import {
  createSimulationSeed,
  generateSimulation,
} from "./lib/simulation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Zipline Operations Intelligence",
  description:
    "A policy-grounded live operations dashboard for fleet, orders, preflight checks, and urgent issues.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ seed?: string | string[] }>;
}) {
  const params = await searchParams;
  const requestedSeed = Array.isArray(params.seed) ? params.seed[0] : params.seed;
  const seed = requestedSeed?.trim() || createSimulationSeed();
  return <OperationsDashboard initialScenario={generateSimulation(seed)} />;
}
